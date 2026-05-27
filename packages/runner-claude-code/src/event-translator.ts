import { z } from 'zod';
import type { ChatEvent } from '@opencodex/core';

export interface TranslatorLogger {
  warn(msg: string, meta?: unknown): void;
}

const textContentBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const toolUseContentBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown().optional(),
});

const toolResultContentBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string().min(1),
  content: z.unknown().optional(),
  is_error: z.boolean().optional(),
});

const contentBlockSchema = z.union([
  textContentBlockSchema,
  toolUseContentBlockSchema,
  toolResultContentBlockSchema,
  z.object({ type: z.string() }).passthrough(),
]);

const assistantMessageSchema = z.object({
  type: z.literal('assistant'),
  message: z.object({
    content: z.array(contentBlockSchema).optional(),
  }),
});

const userMessageSchema = z.object({
  type: z.literal('user'),
  message: z.object({
    content: z.array(contentBlockSchema).optional(),
  }),
});

const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const resultEventSchema = z.object({
  type: z.literal('result'),
  subtype: z.string().optional(),
  is_error: z.boolean().optional(),
  usage: usageSchema.optional(),
  total_cost_usd: z.number().nonnegative().optional(),
});

export interface TranslatorState {
  resultEmitted: boolean;
  usageEmitted: boolean;
}

export function createTranslatorState(): TranslatorState {
  return { resultEmitted: false, usageEmitted: false };
}

export function translateClaudeJson(
  raw: unknown,
  state: TranslatorState,
  logger?: TranslatorLogger,
): ChatEvent[] {
  if (typeof raw !== 'object' || raw === null) {
    logger?.warn('claude-code: non-object stream-json line', { raw });
    return [];
  }
  const typeField = (raw as { type?: unknown }).type;
  if (typeof typeField !== 'string') {
    logger?.warn('claude-code: stream-json missing type field', { raw });
    return [];
  }

  const events: ChatEvent[] = [];

  if (typeField === 'assistant') {
    const parsed = assistantMessageSchema.safeParse(raw);
    if (!parsed.success) {
      logger?.warn('claude-code: malformed assistant message', { raw });
      return [];
    }
    const blocks = parsed.data.message.content ?? [];
    for (const block of blocks) {
      if (block.type === 'text') {
        const text = textContentBlockSchema.safeParse(block);
        if (text.success && text.data.text.length > 0) {
          events.push({ type: 'text_delta', delta: text.data.text });
        }
      } else if (block.type === 'tool_use') {
        const tu = toolUseContentBlockSchema.safeParse(block);
        if (tu.success) {
          events.push({
            type: 'tool_call',
            id: tu.data.id,
            name: tu.data.name,
            arguments: tu.data.input ?? {},
          });
        }
      }
    }
    return events;
  }

  if (typeField === 'user') {
    const parsed = userMessageSchema.safeParse(raw);
    if (!parsed.success) {
      logger?.warn('claude-code: malformed user message', { raw });
      return [];
    }
    const blocks = parsed.data.message.content ?? [];
    for (const block of blocks) {
      if (block.type === 'tool_result') {
        const tr = toolResultContentBlockSchema.safeParse(block);
        if (tr.success) {
          const evt: ChatEvent = {
            type: 'tool_result',
            id: tr.data.tool_use_id,
            output: tr.data.content ?? null,
            ...(tr.data.is_error !== undefined ? { isError: tr.data.is_error } : {}),
          };
          events.push(evt);
        }
      }
    }
    return events;
  }

  if (typeField === 'result') {
    const r = resultEventSchema.safeParse(raw);
    if (!r.success) {
      logger?.warn('claude-code: malformed result event', { raw });
      return [];
    }
    const usage = r.data.usage;
    events.push({
      type: 'usage',
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      ...(usage?.cache_read_input_tokens !== undefined
        ? { cachedInputTokens: usage.cache_read_input_tokens }
        : {}),
      ...(r.data.total_cost_usd !== undefined ? { costUsd: r.data.total_cost_usd } : {}),
    });
    state.usageEmitted = true;
    events.push({
      type: 'done',
      stopReason: r.data.is_error ? 'error' : 'end_turn',
    });
    state.resultEmitted = true;
    return events;
  }

  if (typeField === 'system') {
    return [];
  }

  logger?.warn('claude-code: unknown event type', { type: typeField });
  return [];
}

export class NdjsonBuffer {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let newlineIdx = this.buffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = this.buffer.slice(0, newlineIdx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line.length > 0) lines.push(line);
      newlineIdx = this.buffer.indexOf('\n');
    }
    return lines;
  }

  flush(): string[] {
    const remainder = this.buffer.trim();
    this.buffer = '';
    return remainder.length > 0 ? [remainder] : [];
  }
}
