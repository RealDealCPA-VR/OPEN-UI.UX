import type { OllamaModelEntry, OllamaProbeResult } from '../../shared/ollama';

const PROBE_URL = 'http://127.0.0.1:11434/api/tags';
const PROBE_TIMEOUT_MS = 800;
const BYTES_PER_GB = 1024 * 1024 * 1024;

interface OllamaTagsResponse {
  models?: Array<{ name?: unknown; model?: unknown; size?: unknown }>;
}

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

export async function probeOllama(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<OllamaProbeResult> {
  const ctrl = signal ? undefined : AbortSignal.timeout(PROBE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(PROBE_URL, { signal: signal ?? ctrl });
    if (!res.ok) {
      return { running: false, models: [], error: `HTTP ${res.status}` };
    }
    const raw = (await res.json()) as OllamaTagsResponse;
    const list = Array.isArray(raw.models) ? raw.models : [];
    const models: OllamaModelEntry[] = [];
    for (const item of list) {
      const entry = coerceModelEntry(item);
      if (entry) models.push(entry);
    }
    return { running: true, models };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'probe failed';
    return { running: false, models: [], error: message };
  }
}
