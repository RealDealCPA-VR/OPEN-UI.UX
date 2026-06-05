import type { ContentBlock } from '@opencodex/core';

export function findRunningToolName(blocks: ContentBlock[]): string | null {
  const completedIds = new Set<string>();
  for (const block of blocks) {
    if (block.type === 'tool_result') completedIds.add(block.toolUseId);
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block && block.type === 'tool_use' && !completedIds.has(block.id)) {
      return block.name;
    }
  }
  return null;
}

export function workspaceBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

export function formatTokens(input: number, output: number): string {
  return `${input.toLocaleString()} in · ${output.toLocaleString()} out`;
}

export function formatCostUsd(cost: number): string | null {
  if (!Number.isFinite(cost) || cost <= 0) return null;
  return `$${cost.toFixed(4)}`;
}

function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, '')}m`;
  }
  if (tokens >= 1000) {
    const thousands = tokens / 1000;
    return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `${tokens}`;
}

/**
 * Summarize prompt-cache savings as e.g. `cache 12k · 43%`. Returns null when
 * the provider did not report cached tokens, when there were no input tokens to
 * compare against, or when the cached count is zero — never NaN/undefined/0%.
 */
export function formatCacheSavings(
  cachedInputTokens: number | null | undefined,
  inputTokens: number | null | undefined,
): string | null {
  if (cachedInputTokens === null || cachedInputTokens === undefined) return null;
  if (!Number.isFinite(cachedInputTokens) || cachedInputTokens <= 0) return null;
  if (inputTokens === null || inputTokens === undefined) return null;
  if (!Number.isFinite(inputTokens) || inputTokens <= 0) return null;
  const percent = Math.round((cachedInputTokens / inputTokens) * 100);
  if (percent <= 0) return null;
  return `cache ${formatCompactTokens(cachedInputTokens)} · ${percent}%`;
}

export interface TokenMeter {
  tokens: number;
  context: number;
  ratio: number;
}

export function computeTokenMeterSegments(tokens: number, context: number): TokenMeter | null {
  if (!Number.isFinite(tokens) || !Number.isFinite(context)) return null;
  if (context <= 0) return null;
  const clamped = Math.max(0, tokens);
  const ratio = Math.min(1, clamped / context);
  return { tokens: clamped, context, ratio };
}
