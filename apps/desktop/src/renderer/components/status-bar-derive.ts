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
