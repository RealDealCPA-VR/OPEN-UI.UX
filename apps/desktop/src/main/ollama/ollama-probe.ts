import type { ModelCapabilities } from '@opencodex/core';
import { z } from 'zod';
import type { OllamaModelEntry, OllamaProbeResult } from '../../shared/ollama';
import { getProviderEntry } from '../storage/settings';
import { buildOllamaModelCapabilities } from './ollama-models';

const DEFAULT_BASE = 'http://127.0.0.1:11434';
const LOCALHOST_FALLBACK_BASE = 'http://127.0.0.1:11434';
const PROBE_TIMEOUT_MS = 3_000;
const BYTES_PER_GB = 1024 * 1024 * 1024;
const TAGS_PATH = '/api/tags';

const ollamaTagEntrySchema = z
  .object({
    name: z.unknown(),
    model: z.unknown(),
    size: z.unknown(),
  })
  .partial();

const ollamaTagsResponseSchema = z
  .object({
    models: z.array(ollamaTagEntrySchema).optional(),
  })
  .partial();

function coerceModelEntry(raw: unknown): OllamaModelEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as { name?: unknown; model?: unknown; size?: unknown };
  const id =
    typeof obj.name === 'string' && obj.name.length > 0
      ? obj.name
      : typeof obj.model === 'string' && obj.model.length > 0
        ? obj.model
        : null;
  if (id === null) return null;
  const sizeBytes = typeof obj.size === 'number' && Number.isFinite(obj.size) ? obj.size : 0;
  const sizeGb = sizeBytes > 0 ? Math.round((sizeBytes / BYTES_PER_GB) * 100) / 100 : 0;
  return { id, sizeGb };
}

function stripSlash(s: string): string {
  return s.replace(/\/$/, '');
}

function normalizeHostString(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_BASE;
  if (/^https?:\/\//i.test(trimmed)) return stripSlash(trimmed);
  // OLLAMA_HOST may be just "host:port" or even "host".
  return stripSlash(`http://${trimmed}`);
}

export interface ResolveBaseUrlOptions {
  configuredBaseUrl?: string | null;
  envHost?: string | undefined;
}

/**
 * Precedence: explicit per-provider base URL > OLLAMA_HOST env > default localhost.
 */
export function resolveOllamaBaseUrl(opts: ResolveBaseUrlOptions = {}): string {
  if (opts.configuredBaseUrl && opts.configuredBaseUrl.length > 0) {
    return normalizeHostString(opts.configuredBaseUrl);
  }
  if (opts.envHost && opts.envHost.length > 0) {
    return normalizeHostString(opts.envHost);
  }
  return DEFAULT_BASE;
}

function looksLikeIPv6ConnectFailure(message: string, base: string): boolean {
  if (!/(\[::1?\]|::1?\b|:::?\d+)/.test(base) && !/\bipv6\b/i.test(base)) return false;
  return /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND/i.test(message);
}

async function probeOnce(
  baseUrl: string,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<OllamaProbeResult> {
  const ctrl = signal ? undefined : AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const res = await fetchImpl(`${baseUrl}${TAGS_PATH}`, { signal: signal ?? ctrl });
  if (!res.ok) {
    return { running: false, models: [], error: `HTTP ${res.status}` };
  }
  const parsed = ollamaTagsResponseSchema.safeParse(await res.json());
  const list = parsed.success && parsed.data.models ? parsed.data.models : [];
  const models: OllamaModelEntry[] = [];
  for (const item of list) {
    const entry = coerceModelEntry(item);
    if (entry) models.push(entry);
  }
  return { running: true, models };
}

export interface ProbeOllamaOptions {
  /** Override base URL discovery (test-only). */
  baseUrl?: string;
  /** Override env lookup (test-only). */
  envHost?: string | undefined;
  /** Skip the per-provider config lookup (test-only). */
  skipConfiguredBaseUrl?: boolean;
}

export async function probeOllama(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  options: ProbeOllamaOptions = {},
): Promise<OllamaProbeResult> {
  let configuredBaseUrl: string | null = null;
  if (!options.skipConfiguredBaseUrl) {
    try {
      const entry = getProviderEntry('ollama');
      configuredBaseUrl = entry.baseUrl;
    } catch {
      configuredBaseUrl = null;
    }
  }
  const envHost = options.envHost ?? process.env['OLLAMA_HOST'];
  const baseUrl = options.baseUrl ?? resolveOllamaBaseUrl({ configuredBaseUrl, envHost });

  try {
    return await probeOnce(baseUrl, signal, fetchImpl);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'probe failed';
    if (baseUrl !== LOCALHOST_FALLBACK_BASE && looksLikeIPv6ConnectFailure(message, baseUrl)) {
      try {
        return await probeOnce(LOCALHOST_FALLBACK_BASE, signal, fetchImpl);
      } catch (fallbackErr) {
        const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : 'probe failed';
        return { running: false, models: [], error: fallbackMessage };
      }
    }
    return { running: false, models: [], error: message };
  }
}

const MODEL_LIST_TIMEOUT_MS = 1_500;

/**
 * Load the models the local Ollama daemon actually has pulled (`/api/tags`),
 * matched back to curated capability metadata. Falls back to `staticModels`
 * when the daemon is unreachable or reports nothing, so the picker is never
 * empty just because Ollama isn't running.
 */
export async function loadOllamaModels(
  staticModels: ModelCapabilities[],
): Promise<ModelCapabilities[]> {
  const probe = await probeOllama(AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS));
  if (!probe.running || probe.models.length === 0) {
    return staticModels;
  }
  return buildOllamaModelCapabilities(
    probe.models.map((m) => m.id),
    staticModels,
  );
}
