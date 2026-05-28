import type {
  ContentBlock,
  ImageBlock,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
} from '@opencodex/core';

export type GroupedItem =
  | { kind: 'text'; text: string }
  | { kind: 'image'; block: ImageBlock }
  | { kind: 'tool'; use: ToolUseBlock; result: ToolResultBlock | null };

export function groupContentBlocks(blocks: readonly ContentBlock[]): GroupedItem[] {
  const items: GroupedItem[] = [];
  const indexByToolUseId = new Map<string, number>();

  for (const block of blocks) {
    switch (block.type) {
      case 'text': {
        items.push({ kind: 'text', text: (block as TextBlock).text });
        break;
      }
      case 'image': {
        items.push({ kind: 'image', block: block as ImageBlock });
        break;
      }
      case 'tool_use': {
        const use = block as ToolUseBlock;
        const next: GroupedItem = { kind: 'tool', use, result: null };
        indexByToolUseId.set(use.id, items.length);
        items.push(next);
        break;
      }
      case 'tool_result': {
        const result = block as ToolResultBlock;
        const target = indexByToolUseId.get(result.toolUseId);
        if (target !== undefined) {
          const existing = items[target];
          if (existing && existing.kind === 'tool') {
            items[target] = { kind: 'tool', use: existing.use, result };
            break;
          }
        }
        items.push({
          kind: 'tool',
          use: { type: 'tool_use', id: result.toolUseId, name: 'unknown', arguments: null },
          result,
        });
        break;
      }
    }
  }

  return items;
}

export function formatToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === null || output === undefined) return '';
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

export function formatToolArguments(args: unknown): string {
  if (args === null || args === undefined) return '';
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export function formatRerunPrompt(toolName: string, args: unknown): string {
  const argsText = formatToolArguments(args);
  return argsText.length > 0
    ? `Re-run this tool call: ${toolName}(${argsText})`
    : `Re-run this tool call: ${toolName}()`;
}

const READ_ONLY_TOOLS = new Set<string>(['read_file', 'list_dir', 'glob', 'grep', 'web_fetch']);

export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}
