import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const telemetryConfigSchema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().default(''),
  host: z.string().url().nullable().optional(),
  salt: z.string().optional(),
  allowedHosts: z.array(z.string()).optional(),
  maxQueueSize: z.number().int().min(1).max(100_000).optional(),
  loadRetryTtlMs: z.number().int().min(0).optional(),
});

export type TelemetryConfig = z.infer<typeof telemetryConfigSchema>;

export type TelemetryEventProps = Record<string, string | number | boolean | null | undefined>;

export interface TelemetryClient {
  readonly enabled: boolean;
  track(event: string, props?: TelemetryEventProps, distinctId?: string): void;
  identify(distinctId: string, traits?: TelemetryEventProps): void;
  shutdown(): Promise<void>;
}

const NOOP_CLIENT: TelemetryClient = {
  enabled: false,
  track: () => {},
  identify: () => {},
  shutdown: async () => {},
};

const DEFAULT_HOST = 'https://us.i.posthog.com';
const DEFAULT_MAX_QUEUE_SIZE = 500;
const DEFAULT_LOAD_RETRY_TTL_MS = 5 * 60_000;
const DEFAULT_ALLOWED_HOSTS = ['posthog.com', 'i.posthog.com', 'us.i.posthog.com'];

interface PostHogLike {
  capture(args: { distinctId: string; event: string; properties: TelemetryEventProps }): void;
  identify(args: { distinctId: string; properties: TelemetryEventProps }): void;
  shutdown(): Promise<void>;
}

type PostHogConstructor = new (
  apiKey: string,
  options: { host?: string; flushAt?: number; flushInterval?: number },
) => PostHogLike;

function extractCtor(mod: unknown): PostHogConstructor | null {
  if (!mod || typeof mod !== 'object') return null;
  const m = mod as Record<string, unknown>;
  const candidate = (m['PostHog'] ?? m['default']) as unknown;
  if (typeof candidate !== 'function') return null;
  return candidate as PostHogConstructor;
}

function isHostAllowed(hostUrl: string, allowedHosts: string[]): boolean {
  try {
    const parsed = new URL(hostUrl);
    const host = parsed.hostname.toLowerCase();
    return allowedHosts.some((allowed) => {
      const a = allowed.toLowerCase().trim();
      if (a.length === 0) return false;
      if (a === host) return true;
      return host.endsWith(`.${a}`);
    });
  } catch {
    return false;
  }
}

export function createTelemetry(config: TelemetryConfig | null | undefined): TelemetryClient {
  if (!config) return NOOP_CLIENT;
  const parsed = telemetryConfigSchema.safeParse(config);
  if (!parsed.success) return NOOP_CLIENT;
  const resolvedConfig = parsed.data;
  if (!resolvedConfig.enabled) return NOOP_CLIENT;
  if (!resolvedConfig.apiKey || resolvedConfig.apiKey.trim() === '') return NOOP_CLIENT;

  const host = resolvedConfig.host ?? DEFAULT_HOST;
  const allowedHosts = resolvedConfig.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  if (!isHostAllowed(host, allowedHosts)) return NOOP_CLIENT;

  const maxQueueSize = resolvedConfig.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  const loadRetryTtlMs = resolvedConfig.loadRetryTtlMs ?? DEFAULT_LOAD_RETRY_TTL_MS;

  type QueueItem =
    | { kind: 'track'; event: string; props: TelemetryEventProps; distinctId: string }
    | { kind: 'identify'; distinctId: string; traits: TelemetryEventProps };

  const queue: QueueItem[] = [];
  let droppedEvents = 0;
  let resolved: PostHogLike | null = null;
  let loading: Promise<PostHogLike | null> | null = null;
  let lastLoadFailureAt: number | null = null;
  let disposed = false;

  function enqueue(item: QueueItem): void {
    if (queue.length >= maxQueueSize) {
      queue.shift();
      droppedEvents += 1;
    }
    queue.push(item);
  }

  function shouldAttemptLoad(): boolean {
    if (resolved) return false;
    if (disposed) return false;
    if (loading) return false;
    if (lastLoadFailureAt === null) return true;
    return Date.now() - lastLoadFailureAt >= loadRetryTtlMs;
  }

  async function load(): Promise<PostHogLike | null> {
    if (resolved) return resolved;
    if (loading) return loading;
    if (!shouldAttemptLoad()) return null;
    loading = (async () => {
      try {
        const mod: unknown = await import('posthog-node');
        const Ctor = extractCtor(mod);
        if (!Ctor) {
          lastLoadFailureAt = Date.now();
          return null;
        }
        const client = new Ctor(resolvedConfig.apiKey, {
          host,
          flushAt: 20,
          flushInterval: 10_000,
        });
        resolved = client;
        lastLoadFailureAt = null;
        drainQueue(client);
        return client;
      } catch {
        lastLoadFailureAt = Date.now();
        return null;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function drainQueue(client: PostHogLike): void {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;
      try {
        if (item.kind === 'track') {
          client.capture({
            distinctId: item.distinctId,
            event: item.event,
            properties: item.props,
          });
        } else {
          client.identify({ distinctId: item.distinctId, properties: item.traits });
        }
      } catch {
        // swallow
      }
    }
  }

  return {
    enabled: true,
    track(event, props, distinctId) {
      if (disposed) return;
      const properties = props ?? {};
      const id = distinctId ?? 'anonymous';
      if (resolved) {
        try {
          resolved.capture({ distinctId: id, event, properties });
        } catch {
          // swallow
        }
        return;
      }
      enqueue({ kind: 'track', event, props: properties, distinctId: id });
      if (shouldAttemptLoad()) void load();
    },
    identify(distinctId, traits) {
      if (disposed) return;
      const props = traits ?? {};
      if (resolved) {
        try {
          resolved.identify({ distinctId, properties: props });
        } catch {
          // swallow
        }
        return;
      }
      enqueue({ kind: 'identify', distinctId, traits: props });
      if (shouldAttemptLoad()) void load();
    },
    async shutdown() {
      disposed = true;
      const client = resolved;
      if (client) {
        try {
          await client.shutdown();
        } catch {
          // ignore
        }
      }
      void droppedEvents;
    },
  };
}

export function anonymizeId(input: string, salt: string): string {
  if (typeof salt !== 'string' || salt.length === 0) {
    throw new Error('anonymizeId requires a non-empty per-install salt');
  }
  return createHmac('sha256', salt).update(input, 'utf8').digest('hex');
}

export function generateInstallSalt(): string {
  return randomBytes(32).toString('hex');
}
