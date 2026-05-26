import { z } from 'zod';

export const crashConfigSchema = z.object({
  enabled: z.boolean(),
  dsn: z.string().default(''),
  environment: z.string().optional(),
  release: z.string().optional(),
});

export type CrashConfig = z.infer<typeof crashConfigSchema>;

export type CrashContext = Record<string, string | number | boolean | null | undefined>;

export interface CrashClient {
  readonly enabled: boolean;
  captureException(err: unknown, context?: CrashContext): void;
}

const NOOP_CLIENT: CrashClient = {
  enabled: false,
  captureException: () => {},
};

interface SentryMainModule {
  init(options: SentryInitOptions): void;
  captureException(err: unknown, context?: { extra?: CrashContext }): void;
}

interface SentryEvent {
  request?: { url?: string; headers?: Record<string, string> };
  user?: { id?: string; ip_address?: string; email?: string } | null;
  extra?: Record<string, unknown>;
}

interface SentryInitOptions {
  dsn: string;
  environment?: string;
  release?: string;
  beforeSend?: (event: SentryEvent) => SentryEvent | null;
}

let installed: { client: CrashClient; sentry: SentryMainModule } | null = null;

/**
 * Initialize crash reporting. No-op when disabled or when dsn is empty.
 *
 * `@sentry/electron/main` is imported lazily so the disabled path never loads
 * the SDK.
 */
export async function initCrash(config: CrashConfig): Promise<CrashClient> {
  if (!config.enabled || !config.dsn || config.dsn.trim() === '') {
    return NOOP_CLIENT;
  }
  if (installed) return installed.client;

  let sentry: SentryMainModule;
  try {
    sentry = (await import('@sentry/electron/main')) as unknown as SentryMainModule;
  } catch {
    return NOOP_CLIENT;
  }

  try {
    const initOptions: SentryInitOptions = {
      dsn: config.dsn,
      beforeSend: scrubEvent,
    };
    if (config.environment) initOptions.environment = config.environment;
    if (config.release) initOptions.release = config.release;
    sentry.init(initOptions);
  } catch {
    return NOOP_CLIENT;
  }

  const client: CrashClient = {
    enabled: true,
    captureException(err, context) {
      try {
        if (context) sentry.captureException(err, { extra: context });
        else sentry.captureException(err);
      } catch {
        // swallow
      }
    },
  };

  installed = { client, sentry };
  return client;
}

export function captureException(err: unknown, context?: CrashContext): void {
  if (!installed) return;
  installed.client.captureException(err, context);
}

/**
 * Strip PII from an event before it leaves the process:
 * - Drop user info (id, email, ip).
 * - Strip file paths from request URLs by replacing the path with `<path>`.
 * - Drop any `extra` value that looks like an absolute file path.
 */
export function scrubEvent(event: SentryEvent): SentryEvent {
  if (event.user) {
    event.user = null;
  }
  if (event.request?.url) {
    event.request.url = redactPath(event.request.url);
  }
  if (event.extra) {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(event.extra)) {
      if (typeof v === 'string' && looksLikePath(v)) {
        cleaned[k] = '<redacted-path>';
      } else {
        cleaned[k] = v;
      }
    }
    event.extra = cleaned;
  }
  return event;
}

function redactPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/<path>`;
  } catch {
    return '<redacted-url>';
  }
}

function looksLikePath(value: string): boolean {
  if (value.length < 3) return false;
  if (/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(value)) return true;
  return false;
}

/** Test-only escape hatch. */
export function _resetForTesting(): void {
  installed = null;
}
