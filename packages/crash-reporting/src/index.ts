import { z } from 'zod';

export const crashConfigSchema = z.object({
  enabled: z.boolean(),
  dsn: z.string().default(''),
  environment: z.string().optional(),
  release: z.string().optional(),
  allowedHosts: z.array(z.string()).optional(),
});

export type CrashConfig = z.infer<typeof crashConfigSchema>;

export type CrashContext = Record<string, string | number | boolean | null | undefined>;

export interface CrashClient {
  readonly enabled: boolean;
  captureException(err: unknown, context?: CrashContext): void;
  close(): Promise<void>;
}

const NOOP_CLIENT: CrashClient = {
  enabled: false,
  captureException: () => {},
  close: async () => {},
};

interface SentryIntegration {
  name: string;
}

interface SentryMainModule {
  init(options: SentryInitOptions): void;
  captureException(err: unknown, context?: { extra?: CrashContext }): void;
  close(timeout?: number): Promise<boolean>;
  onUncaughtExceptionIntegration?: () => SentryIntegration;
  onUnhandledRejectionIntegration?: () => SentryIntegration;
  sentryMinidumpIntegration?: () => SentryIntegration;
  additionalContextIntegration?: () => SentryIntegration;
  electronContextIntegration?: () => SentryIntegration;
  normalizePathsIntegration?: () => SentryIntegration;
}

interface SentryStackFrame {
  filename?: string;
  abs_path?: string;
  vars?: Record<string, unknown>;
}

interface SentryStacktrace {
  frames?: SentryStackFrame[];
}

interface SentryExceptionValue {
  value?: string;
  stacktrace?: SentryStacktrace;
}

interface SentryBreadcrumb {
  message?: string;
  data?: Record<string, unknown>;
  category?: string;
}

export interface SentryEvent {
  request?: { url?: string; headers?: Record<string, string>; data?: unknown };
  user?: { id?: string; ip_address?: string; email?: string } | null;
  extra?: Record<string, unknown>;
  message?: string;
  tags?: Record<string, string>;
  contexts?: Record<string, Record<string, unknown> | undefined>;
  breadcrumbs?: SentryBreadcrumb[];
  exception?: { values?: SentryExceptionValue[] };
}

interface SentryInitOptions {
  dsn: string;
  environment?: string;
  release?: string;
  beforeSend?: (event: SentryEvent) => SentryEvent | null;
  defaultIntegrations?: false;
  integrations?: SentryIntegration[];
  tracesSampleRate?: number;
  sampleRate?: number;
  maxBreadcrumbs?: number;
}

interface InstalledState {
  client: CrashClient;
  sentry: SentryMainModule;
}

let installed: InstalledState | null = null;

const DEFAULT_ALLOWED_HOSTS = ['sentry.io', 'ingest.sentry.io', 'ingest.us.sentry.io'];

export async function initCrash(rawConfig: CrashConfig): Promise<CrashClient> {
  const config = crashConfigSchema.parse(rawConfig);
  if (!config.enabled || !config.dsn || config.dsn.trim() === '') {
    return NOOP_CLIENT;
  }

  const allowedHosts = config.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  if (!isDsnHostAllowed(config.dsn, allowedHosts)) {
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
    const integrations = buildMinimalIntegrations(sentry);
    const initOptions: SentryInitOptions = {
      dsn: config.dsn,
      beforeSend: scrubEvent,
      defaultIntegrations: false,
      integrations,
      tracesSampleRate: 0.1,
      sampleRate: 1.0,
      maxBreadcrumbs: 50,
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
    async close() {
      try {
        await sentry.close(2000);
      } catch {
        // swallow
      } finally {
        installed = null;
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

export async function closeCrash(): Promise<void> {
  if (!installed) return;
  await installed.client.close();
}

export function isCrashInstalled(): boolean {
  return installed !== null;
}

function buildMinimalIntegrations(sentry: SentryMainModule): SentryIntegration[] {
  const integrations: SentryIntegration[] = [];
  const candidates: Array<(() => SentryIntegration) | undefined> = [
    sentry.onUncaughtExceptionIntegration,
    sentry.onUnhandledRejectionIntegration,
    sentry.sentryMinidumpIntegration,
    sentry.electronContextIntegration,
    sentry.additionalContextIntegration,
    sentry.normalizePathsIntegration,
  ];
  for (const factory of candidates) {
    if (typeof factory !== 'function') continue;
    try {
      integrations.push(factory());
    } catch {
      // ignore integration construction errors
    }
  }
  return integrations;
}

function isDsnHostAllowed(dsn: string, allowedHosts: string[]): boolean {
  try {
    const parsed = new URL(dsn);
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

export function scrubEvent(event: SentryEvent): SentryEvent {
  if (event.user) {
    event.user = null;
  }
  if (event.request) {
    if (event.request.url) event.request.url = redactPath(event.request.url);
    if (event.request.headers) event.request.headers = scrubHeaders(event.request.headers);
    if (event.request.data !== undefined) event.request.data = scrubValue(event.request.data);
  }
  if (event.extra) {
    event.extra = scrubObject(event.extra);
  }
  if (event.tags) {
    event.tags = scrubTags(event.tags);
  }
  if (event.contexts) {
    const cleaned: Record<string, Record<string, unknown> | undefined> = {};
    for (const [k, v] of Object.entries(event.contexts)) {
      cleaned[k] = v ? scrubObject(v) : v;
    }
    event.contexts = cleaned;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  }
  if (typeof event.message === 'string') {
    event.message = scrubString(event.message);
  }
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map(scrubExceptionValue);
  }
  return event;
}

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
]);

function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(k.toLowerCase())) {
      cleaned[k] = '<redacted>';
    } else {
      cleaned[k] = typeof v === 'string' ? scrubString(v) : v;
    }
  }
  return cleaned;
}

function scrubTags(tags: Record<string, string>): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    cleaned[k] = typeof v === 'string' ? scrubString(v) : v;
  }
  return cleaned;
}

function scrubBreadcrumb(crumb: SentryBreadcrumb): SentryBreadcrumb {
  const next: SentryBreadcrumb = { ...crumb };
  if (typeof next.message === 'string') next.message = scrubString(next.message);
  if (next.data) next.data = scrubObject(next.data);
  return next;
}

function scrubExceptionValue(value: SentryExceptionValue): SentryExceptionValue {
  const next: SentryExceptionValue = { ...value };
  if (typeof next.value === 'string') next.value = scrubString(next.value);
  if (next.stacktrace?.frames) {
    next.stacktrace = {
      ...next.stacktrace,
      frames: next.stacktrace.frames.map(scrubFrame),
    };
  }
  return next;
}

function scrubFrame(frame: SentryStackFrame): SentryStackFrame {
  const next: SentryStackFrame = { ...frame };
  if (typeof next.filename === 'string' && looksLikePath(next.filename)) {
    next.filename = '<redacted-path>';
  }
  if (typeof next.abs_path === 'string' && looksLikePath(next.abs_path)) {
    next.abs_path = '<redacted-path>';
  }
  if (next.vars) next.vars = scrubObject(next.vars);
  return next;
}

function scrubObject(input: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    cleaned[k] = scrubValue(v);
  }
  return cleaned;
}

function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (looksLikePath(value)) return '<redacted-path>';
    return scrubString(value);
  }
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value !== null && typeof value === 'object') {
    return scrubObject(value as Record<string, unknown>);
  }
  return value;
}

function scrubString(value: string): string {
  if (looksLikePath(value)) return '<redacted-path>';
  return value;
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

export function _resetForTesting(): void {
  installed = null;
}
