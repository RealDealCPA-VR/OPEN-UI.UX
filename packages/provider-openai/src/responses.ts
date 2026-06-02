import { z } from 'zod';
import type {
  ChatEvent,
  ChatRequest,
  ContentBlock,
  Message,
  StopReason,
  ToolDefinition,
} from '@opencodex/core';
import { computeCostUsd, fetchWithRetry, sanitizeErrorDetail } from '@opencodex/core';
import type { OpenAIConfig } from './config';
import { findModel } from './models';
import { sseEvents } from './sse';
import { reasoningEffort } from './translate-request';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

type ResponsesInputContent =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'output_text'; text: string };

interface ResponsesInputMessage {
  type: 'message';
  role: 'system' | 'user' | 'assistant';
  content: ResponsesInputContent[];
}

interface ResponsesFunctionCallItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

interface ResponsesFunctionCallOutputItem {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

type ResponsesInputItem =
  | ResponsesInputMessage
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem;

interface ResponsesTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

type ResponsesToolChoice = 'auto' | 'required' | 'none' | { type: 'function'; name: string };

type ResponsesTextFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; name?: string; schema: Record<string, unknown> };

interface ResponsesRequestBody {
  model: string;
  input: ResponsesInputItem[];
  stream: boolean;
  temperature?: number;
  max_output_tokens?: number;
  top_p?: number;
  tools?: ResponsesTool[];
  tool_choice?: ResponsesToolChoice;
  text?: { format: ResponsesTextFormat };
  reasoning?: { effort: 'low' | 'medium' | 'high' };
}

type MessageRole = 'system' | 'user' | 'assistant';

function isMessageRole(role: Message['role']): role is MessageRole {
  return role === 'system' || role === 'user' || role === 'assistant';
}

function blockToContent(block: ContentBlock, role: MessageRole): ResponsesInputContent | undefined {
  if (block.type === 'text') {
    return role === 'assistant'
      ? { type: 'output_text', text: block.text }
      : { type: 'input_text', text: block.text };
  }
  if (block.type === 'image') {
    return { type: 'input_image', image_url: `data:${block.mimeType};base64,${block.data}` };
  }
  return undefined;
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === null) return 'null';
  if (output === undefined) return '';
  return JSON.stringify(output);
}

function translateMessagesForResponses(messages: Message[]): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];
  let lastToolUseId: string | undefined;
  for (const msg of messages) {
    const role: MessageRole = isMessageRole(msg.role) ? msg.role : 'user';

    if (typeof msg.content === 'string') {
      if (msg.role === 'tool') {
        if (!lastToolUseId) continue;
        items.push({
          type: 'function_call_output',
          call_id: lastToolUseId,
          output: msg.content,
        });
        continue;
      }
      items.push({
        type: 'message',
        role,
        content: [
          role === 'assistant'
            ? { type: 'output_text', text: msg.content }
            : { type: 'input_text', text: msg.content },
        ],
      });
      continue;
    }

    for (const block of msg.content) {
      if (block.type === 'tool_use') lastToolUseId = block.id;
    }

    let messageContent: ResponsesInputContent[] = [];
    const flush = (): void => {
      if (messageContent.length > 0) {
        items.push({ type: 'message', role, content: messageContent });
        messageContent = [];
      }
    };

    for (const block of msg.content) {
      if (block.type === 'text' || block.type === 'image') {
        const part = blockToContent(block, role);
        if (part) messageContent.push(part);
      } else if (block.type === 'tool_use') {
        flush();
        items.push({
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments:
            typeof block.arguments === 'string'
              ? block.arguments
              : JSON.stringify(block.arguments ?? {}),
        });
      } else if (block.type === 'tool_result') {
        flush();
        items.push({
          type: 'function_call_output',
          call_id: block.toolUseId,
          output: stringifyToolOutput(block.output),
        });
      }
    }
    flush();
  }
  return items;
}

function translateToolsForResponses(
  tools: ToolDefinition[] | undefined,
): ResponsesTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));
}

export function buildResponsesRequestBody(
  req: ChatRequest,
  opts: { stream: boolean },
): ResponsesRequestBody {
  const body: ResponsesRequestBody = {
    model: req.model,
    input: translateMessagesForResponses(req.messages),
    stream: opts.stream,
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.maxTokens !== undefined) body.max_output_tokens = req.maxTokens;
  if (req.topP !== undefined) body.top_p = req.topP;
  const tools = translateToolsForResponses(req.tools);
  if (tools) body.tools = tools;
  if (req.toolChoice !== undefined) {
    const tc = translateToolChoiceForResponses(req.toolChoice);
    if (tc !== undefined) body.tool_choice = tc;
  }
  if (req.responseFormat !== undefined) {
    body.text = { format: translateResponseFormatForResponses(req.responseFormat) };
  }
  const effort = reasoningEffort(req.reasoning);
  if (effort) body.reasoning = { effort };
  // NOTE: the Responses API has no `stop` parameter (unlike Chat Completions),
  // so req.stop is intentionally not forwarded here — sending it would 400.
  return body;
}

function translateToolChoiceForResponses(
  choice: NonNullable<ChatRequest['toolChoice']>,
): ResponsesToolChoice | undefined {
  if (choice === 'auto' || choice === 'required' || choice === 'none') return choice;
  if (typeof choice === 'object' && typeof choice.name === 'string') {
    return { type: 'function', name: choice.name };
  }
  return undefined;
}

function translateResponseFormatForResponses(
  format: NonNullable<ChatRequest['responseFormat']>,
): ResponsesTextFormat {
  if (format.type === 'text') return { type: 'text' };
  if (format.type === 'json_object') return { type: 'json_object' };
  return {
    type: 'json_schema',
    name: format.name ?? 'response',
    schema: format.schema as Record<string, unknown>,
  };
}

const responseEventSchema = z.object({
  type: z.string(),
  delta: z.string().optional(),
  item: z
    .object({
      type: z.string().optional(),
      id: z.string().optional(),
      call_id: z.string().optional(),
      name: z.string().optional(),
      arguments: z.string().optional(),
    })
    .optional(),
  output_index: z.number().int().nonnegative().optional(),
  response: z
    .object({
      usage: z
        .object({
          input_tokens: z.number().int().nonnegative().optional(),
          output_tokens: z.number().int().nonnegative().optional(),
          input_tokens_details: z
            .object({
              cached_tokens: z.number().int().nonnegative().optional(),
            })
            .optional(),
        })
        .optional(),
      status: z.string().optional(),
      incomplete_details: z
        .object({
          reason: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  error: z
    .object({
      message: z.string().optional(),
      type: z.string().optional(),
      code: z.string().optional(),
    })
    .optional(),
  message: z.string().optional(),
});

type ResponseEvent = z.infer<typeof responseEventSchema>;

interface PendingFunctionCall {
  id: string;
  name: string;
  arguments: string;
}

function mapStatusToStopReason(status: string | undefined, reason: string | undefined): StopReason {
  if (status === 'incomplete') {
    if (reason === 'max_output_tokens') return 'max_tokens';
    if (reason === 'stop_sequence') return 'stop_sequence';
    return 'end_turn';
  }
  return 'end_turn';
}

async function* parseResponseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ResponseEvent> {
  for await (const data of sseEvents(body)) {
    if (data === '[DONE]') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    const result = responseEventSchema.safeParse(parsed);
    if (result.success) yield result.data;
  }
}

export interface ResponseEventsOptions {
  model?: string;
}

export async function* responseEventsToChatEvents(
  events: AsyncIterable<ResponseEvent>,
  opts: ResponseEventsOptions = {},
): AsyncGenerator<ChatEvent, void, void> {
  const pending = new Map<number, PendingFunctionCall>();
  let sawFunctionCall = false;
  let stopReason: StopReason = 'end_turn';
  let emittedDone = false;

  for await (const evt of events) {
    switch (evt.type) {
      case 'response.output_text.delta': {
        if (evt.delta) yield { type: 'text_delta', delta: evt.delta };
        break;
      }
      case 'response.output_item.added': {
        if (evt.item?.type === 'function_call' && evt.output_index !== undefined) {
          pending.set(evt.output_index, {
            id: evt.item.call_id ?? evt.item.id ?? '',
            name: evt.item.name ?? '',
            arguments: evt.item.arguments ?? '',
          });
        }
        break;
      }
      case 'response.function_call_arguments.delta': {
        if (evt.output_index !== undefined && evt.delta) {
          const cur = pending.get(evt.output_index);
          if (cur) cur.arguments += evt.delta;
        }
        break;
      }
      case 'response.output_item.done': {
        if (evt.item?.type === 'function_call' && evt.output_index !== undefined) {
          const cur = pending.get(evt.output_index);
          if (cur) {
            if (evt.item.call_id) cur.id = evt.item.call_id;
            if (evt.item.name) cur.name = evt.item.name;
            if (evt.item.arguments !== undefined) cur.arguments = evt.item.arguments;
          } else if (evt.item.call_id) {
            pending.set(evt.output_index, {
              id: evt.item.call_id,
              name: evt.item.name ?? '',
              arguments: evt.item.arguments ?? '',
            });
          }
        }
        break;
      }
      case 'response.completed': {
        const usage = evt.response?.usage;
        if (usage && (usage.input_tokens !== undefined || usage.output_tokens !== undefined)) {
          const cached = usage.input_tokens_details?.cached_tokens;
          const pricing = opts.model ? findModel(opts.model)?.pricing : undefined;
          const cost = computeCostUsd({
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
            ...(pricing ? { pricing } : {}),
          });
          yield {
            type: 'usage',
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
            ...(cost !== undefined ? { costUsd: cost } : {}),
          };
        }
        stopReason = mapStatusToStopReason(
          evt.response?.status,
          evt.response?.incomplete_details?.reason,
        );
        break;
      }
      case 'response.incomplete': {
        const usage = evt.response?.usage;
        if (usage && (usage.input_tokens !== undefined || usage.output_tokens !== undefined)) {
          const pricing = opts.model ? findModel(opts.model)?.pricing : undefined;
          const cost = computeCostUsd({
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            ...(pricing ? { pricing } : {}),
          });
          yield {
            type: 'usage',
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            ...(cost !== undefined ? { costUsd: cost } : {}),
          };
        }
        stopReason = mapStatusToStopReason('incomplete', evt.response?.incomplete_details?.reason);
        break;
      }
      case 'response.failed':
      case 'error': {
        const message = evt.error?.message ?? evt.message ?? 'unknown error';
        const errType = evt.error?.type ?? '';
        yield {
          type: 'error',
          message: errType ? `${errType}: ${message}` : message,
          retryable: errType === 'server_error' || errType === 'rate_limit_error',
        };
        yield { type: 'done', stopReason: 'error' };
        emittedDone = true;
        return;
      }
      default:
        break;
    }
  }

  for (const [, call] of [...pending.entries()].sort(([a], [b]) => a - b)) {
    sawFunctionCall = true;
    let args: unknown = {};
    if (call.arguments) {
      try {
        args = JSON.parse(call.arguments);
      } catch {
        args = call.arguments;
      }
    }
    yield { type: 'tool_call', id: call.id, name: call.name, arguments: args };
  }

  if (!emittedDone) {
    yield { type: 'done', stopReason: sawFunctionCall ? 'tool_use' : stopReason };
  }
}

export async function* responsesStream(
  req: ChatRequest,
  config: OpenAIConfig,
): AsyncIterable<ChatEvent> {
  const body = buildResponsesRequestBody(req, { stream: true });
  const base = config.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${base.replace(/\/$/, '')}/responses`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (config.apiKey) headers['authorization'] = `Bearer ${config.apiKey}`;
  if (config.organization) headers['openai-organization'] = config.organization;
  if (config.project) headers['openai-project'] = config.project;
  if (config.headers) Object.assign(headers, config.headers);

  const init: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  };
  if (req.signal) init.signal = req.signal;

  const response = await fetchWithRetry(
    () => fetch(url, init),
    req.signal ? { signal: req.signal } : {},
  );
  if (!response.ok || !response.body) {
    let detail = '<unreadable body>';
    try {
      detail = sanitizeErrorDetail(await response.text());
    } catch {
      // keep default
    }
    yield {
      type: 'error',
      message: `OpenAI responses HTTP ${response.status}: ${detail}`,
      retryable: response.status >= 500 || response.status === 429,
    };
    yield { type: 'done', stopReason: 'error' };
    return;
  }
  yield* responseEventsToChatEvents(parseResponseEvents(response.body), { model: req.model });
}
