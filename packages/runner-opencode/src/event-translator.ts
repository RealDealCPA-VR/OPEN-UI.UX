import { z } from 'zod';
import type { ChatEvent } from '@opencodex/core';

export interface TranslatorLogger {
  warn(msg: string, meta?: unknown): void;
}

const textEventSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const toolEventSchema = z.object({
  type: z.literal('tool'),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown().optional(),
});

const toolResultEventSchema = z.object({
  type: z.literal('tool_result'),
  id: z.string().min(1),
  output: z.unknown().optional(),
  is_error: z.boolean().optional(),
});

const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    cached_input_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const doneEventSchema = z.object({
  type: z.literal('done'),
  is_error: z.boolean().optional(),
  usage: usageSchema.optional(),
  total_cost_usd: z.number().nonnegative().optional(),
});

const errorEventSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  retryable: z.boolean().optional(),
});

export interface TranslatorState {
  resultEmitted: boolean;
  usageEmitted: boolean;
}

export function createTranslatorState(): TranslatorState {
  return { resultEmitted: false, usageEmitted: false };
}

export function translateOpenCodeJson(
  raw: unknown,
  state: TranslatorState,
  logger?: TranslatorLogger,
): ChatEvent[] {
  if (typeof raw !== 'object' || raw === null) {
    logger?.warn('opencode: non-object stream-json line', { raw });
    return [];
  }
  const typeField = (raw as { type?: unknown }).type;
  if (typeof typeField !== 'string') {
    logger?.warn('opencode: stream-json missing type field', { raw });
    return [];
  }

  const events: ChatEvent[] = [];

  if (typeField === 'text') {
    const parsed = textEventSchema.safeParse(raw);
    if (!parsed.success) {
      logger?.warn('opencode: malformed text event', { raw });
      return [];
    }
    if (parsed.data.text.length > 0) {
      events.push({ type: 'text_delta', delta: parsed.data.text });
    }
    return events;
  }

  if (typeField === 'tool') {
    const parsed = toolEventSchema.safeParse(raw);
    if (!parsed.success) {
      logger?.warn('opencode: malformed tool event', { raw });
      return [];
    }
    events.push({
      type: 'tool_call',
      id: parsed.data.id,
      name: parsed.data.name,
      arguments: parsed.data.input ?? {},
    });
    return events;
  }

  if (typeField === 'tool_result') {
    const parsed = toolResultEventSchema.safeParse(raw);
    if (!parsed.success) {
      logger?.warn('opencode: malformed tool_result event', { raw });
      return [];
    }
    const evt: ChatEvent = {
      type: 'tool_result',
      id: parsed.data.id,
      output: parsed.data.output ?? null,
      ...(parsed.data.is_error !== undefined ? { isError: parsed.data.is_error } : {}),
    };
    events.push(evt);
    return events;
  }

  if (typeField === 'done') {
    const parsed = doneEventSchema.safeParse(raw);
    if (!parsed.success) {
      logger?.warn('opencode: malformed done event', { raw });
      return [];
    }
    const usage = parsed.data.usage;
    events.push({
      type: 'usage',
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      ...(usage?.cached_input_tokens !== undefined
        ? { cachedInputTokens: usage.cached_input_tokens }
        : {}),
      ...(parsed.data.total_cost_usd !== undefined ? { costUsd: parsed.data.total_cost_usd } : {}),
    });
    state.usageEmitted = true;
    events.push({
      type: 'done',
      stopReason: parsed.data.is_error ? 'error' : 'end_turn',
    });
    state.resultEmitted = true;
    return events;
  }

  if (typeField === 'error') {
    const parsed = errorEventSchema.safeParse(raw);
    if (!parsed.success) {
      logger?.warn('opencode: malformed error event', { raw });
      return [];
    }
    events.push({
      type: 'error',
      message: parsed.data.message,
      retryable: parsed.data.retryable ?? false,
    });
    return events;
  }

  if (typeField === 'system' || typeField === 'status') {
    return [];
  }

  logger?.warn('opencode: unknown event type', { type: typeField });
  return [];
}

const NDJSON_DEFAULT_MAX_BYTES = 1 * 1024 * 1024;

export class NdjsonBuffer {
  private buffer = '';
  private readonly maxBytes: number;

  constructor(maxBytes: number = NDJSON_DEFAULT_MAX_BYTES) {
    this.maxBytes = maxBytes;
  }

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
    if (this.buffer.length > this.maxBytes) {
      this.buffer = '';
    }
    return lines;
  }

  flush(): string[] {
    const remainder = this.buffer.trim();
    this.buffer = '';
    return remainder.length > 0 ? [remainder] : [];
  }
}
