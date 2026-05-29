import {
  DEFAULT_MCP_REGISTRY_URL,
  mcpRegistrySchema,
  type McpFetchRegistryResponse,
  type McpRegistryEntry,
} from '../../shared/mcp-registry';

const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  url: string;
  entries: McpRegistryEntry[];
  fetchedAt: number;
}

interface FetcherState {
  cache: CacheEntry | null;
  now: () => number;
  fetchImpl: typeof fetch;
}

const state: FetcherState = {
  cache: null,
  now: () => Date.now(),
  fetchImpl: globalThis.fetch.bind(globalThis),
};

export interface RegistryFetcherTestHooks {
  now?: () => number;
  fetchImpl?: typeof fetch;
}

export function __setRegistryFetcherForTest(hooks: RegistryFetcherTestHooks): void {
  if (hooks.now) state.now = hooks.now;
  if (hooks.fetchImpl) state.fetchImpl = hooks.fetchImpl;
}

export function __resetRegistryFetcherForTest(): void {
  state.cache = null;
  state.now = () => Date.now();
  state.fetchImpl = globalThis.fetch.bind(globalThis);
}

export function getCachedRegistry(): CacheEntry | null {
  return state.cache;
}

export function clearRegistryCache(): void {
  state.cache = null;
}

export async function fetchMcpRegistry(url: string | null): Promise<McpFetchRegistryResponse> {
  const target = url && url.length > 0 ? url : DEFAULT_MCP_REGISTRY_URL;
  const cached = state.cache;
  if (cached && cached.url === target && state.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      entries: cached.entries,
      error: null,
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
      cached: true,
    };
  }

  try {
    const response = await state.fetchImpl(target, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { entries: [], error: `HTTP ${response.status}`, fetchedAt: null, cached: false };
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('json')) {
      return {
        entries: [],
        error: `unexpected content-type: ${contentType || 'unknown'}`,
        fetchedAt: null,
        cached: false,
      };
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch (err) {
      return {
        entries: [],
        error: `malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
        fetchedAt: null,
        cached: false,
      };
    }
    const candidate = Array.isArray(raw) ? raw : (raw as { entries?: unknown })?.entries;
    const parsed = mcpRegistrySchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        entries: [],
        error: `schema mismatch: ${parsed.error.issues[0]?.message ?? 'invalid registry shape'}`,
        fetchedAt: null,
        cached: false,
      };
    }
    const fetchedAtMs = state.now();
    state.cache = { url: target, entries: parsed.data, fetchedAt: fetchedAtMs };
    return {
      entries: parsed.data,
      error: null,
      fetchedAt: new Date(fetchedAtMs).toISOString(),
      cached: false,
    };
  } catch (err) {
    return {
      entries: [],
      error: err instanceof Error ? err.message : String(err),
      fetchedAt: null,
      cached: false,
    };
  }
}
