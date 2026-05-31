import type { ModelCapabilities } from '@opencodex/core';

const DEFAULT_CONTEXT_WINDOW = 8_192;

// "llama3.1:8b" -> "llama3.1"; "qwen2.5-coder:7b-instruct" -> "qwen2.5-coder".
function familyOf(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(0, colon);
}

function looksLikeEmbedding(id: string): boolean {
  return /embed/i.test(id);
}

function looksLikeVision(id: string): boolean {
  return /llava|vision|moondream|bakllava/i.test(id);
}

/**
 * Turn the list of locally-installed Ollama tags (from `/api/tags`) into model
 * capabilities. When a tag matches a curated family (e.g. `llama3.1:8b` ->
 * `llama3.1`) we reuse that family's capability metadata but keep the real,
 * installed tag as the id/displayName. Unknown tags get conservative defaults
 * so they still appear and stay selectable.
 *
 * Pure (no I/O) so it can be unit-tested; the probe + fallback wiring lives in
 * `ollama-probe.ts` (`loadOllamaModels`).
 */
export function buildOllamaModelCapabilities(
  liveIds: readonly string[],
  known: readonly ModelCapabilities[],
): ModelCapabilities[] {
  const byId = new Map(known.map((m) => [m.id, m]));
  const out: ModelCapabilities[] = [];
  const seen = new Set<string>();
  for (const id of liveIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const match = byId.get(id) ?? byId.get(familyOf(id));
    if (match) {
      out.push({ ...match, id, displayName: id });
      continue;
    }
    const embeddings = looksLikeEmbedding(id);
    out.push({
      id,
      providerId: 'ollama',
      displayName: id,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      toolUse: false,
      vision: looksLikeVision(id),
      streaming: !embeddings,
      embeddings,
    });
  }
  return out;
}
