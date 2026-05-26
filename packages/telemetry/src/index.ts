import { z } from 'zod';

export const telemetryConfigSchema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().default(''),
  host: z.string().url().nullable().optional(),
});

export type TelemetryConfig = z.infer<typeof telemetryConfigSchema>;

export type TelemetryEventProps = Record<string, string | number | boolean | null | undefined>;

export interface TelemetryClient {
  readonly enabled: boolean;
  track(event: string, props?: TelemetryEventProps): void;
  identify(distinctId: string, traits?: TelemetryEventProps): void;
  shutdown(): Promise<void>;
}

const NOOP_CLIENT: TelemetryClient = {
  enabled: false,
  track: () => {},
  identify: () => {},
  shutdown: async () => {},
};

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

/**
 * Create a telemetry client.
 *
 * - Returns a no-op client immediately if the config is null, disabled, or has no apiKey.
 * - When enabled, the underlying PostHog SDK is loaded lazily on first track/identify
 *   call. Until that point the queued events are buffered; lookups that fail
 *   (e.g. posthog-node not installed) silently fall back to no-op.
 */
export function createTelemetry(config: TelemetryConfig | null | undefined): TelemetryClient {
  if (!config) return NOOP_CLIENT;
  if (!config.enabled) return NOOP_CLIENT;
  if (!config.apiKey || config.apiKey.trim() === '') return NOOP_CLIENT;
  const resolvedConfig: TelemetryConfig = config;

  type QueueItem =
    | { kind: 'track'; event: string; props: TelemetryEventProps }
    | { kind: 'identify'; distinctId: string; traits: TelemetryEventProps };

  const queue: QueueItem[] = [];
  let resolved: PostHogLike | null = null;
  let loading: Promise<PostHogLike | null> | null = null;
  let disposed = false;

  async function load(): Promise<PostHogLike | null> {
    if (resolved) return resolved;
    if (loading) return loading;
    loading = (async () => {
      try {
        const mod: unknown = await import('posthog-node');
        const Ctor = extractCtor(mod);
        if (!Ctor) return null;
        const client = new Ctor(resolvedConfig.apiKey, {
          host: resolvedConfig.host ?? 'https://us.i.posthog.com',
          flushAt: 20,
          flushInterval: 10_000,
        });
        resolved = client;
        drainQueue(client);
        return client;
      } catch {
        return null;
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
            distinctId: 'anonymous',
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
    track(event, props) {
      if (disposed) return;
      const properties = props ?? {};
      if (resolved) {
        try {
          resolved.capture({ distinctId: 'anonymous', event, properties });
        } catch {
          // swallow
        }
        return;
      }
      queue.push({ kind: 'track', event, props: properties });
      void load();
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
      queue.push({ kind: 'identify', distinctId, traits: props });
      void load();
    },
    async shutdown() {
      disposed = true;
      const client = resolved ?? (await load());
      if (client) {
        try {
          await client.shutdown();
        } catch {
          // ignore
        }
      }
    },
  };
}

/**
 * Stable, anonymized hash of a string. Used to avoid sending raw provider/model
 * IDs that could be cross-referenced against the user. Output is hex.
 */
export function anonymizeId(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}
