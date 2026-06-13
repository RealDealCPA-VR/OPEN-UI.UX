import type { ChatRequest, Message, ToolDefinition } from '@opencodex/core';
import { findModel } from './models';

type OpenAITextPart = { type: 'text'; text: string };
type OpenAIImagePart = { type: 'image_url'; image_url: { url: string } };
type OpenAIContentPart = OpenAITextPart | OpenAIImagePart;

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type OpenAIToolChoice =
  | 'auto'
  | 'required'
  | 'none'
  | { type: 'function'; function: { name: string } };

export type OpenAIResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      json_schema: {
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean;
      };
    };

export interface OpenAIChatRequestBody {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  top_p?: number;
  stop?: string[];
  tools?: OpenAITool[];
  stream: boolean;
  stream_options?: { include_usage: boolean };
  tool_choice?: OpenAIToolChoice;
  response_format?: OpenAIResponseFormat;
  reasoning_effort?: 'low' | 'medium' | 'high';
}

/**
 * Map the provider-agnostic ReasoningOption to OpenAI's `reasoning_effort`
 * (Chat Completions) / the Responses API `reasoning.effort`. `true` means
 * "reason at the default effort"; an explicit `effort` wins. A reasoning
 * token budget (the object's `maxTokens`) has no Chat-Completions equivalent
 * and is ignored here — it maps to Anthropic's `thinking.budget_tokens`.
 */
export function reasoningEffort(
  reasoning: ChatRequest['reasoning'],
): 'low' | 'medium' | 'high' | undefined {
  if (reasoning === undefined || reasoning === false) return undefined;
  if (reasoning === true) return 'medium';
  return reasoning.effort ?? 'medium';
}

export function translateMessages(messages: Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  // OpenAI rejects role:'tool' messages without tool_call_id, but core's
  // messageSchema allows { role: 'tool', content: string } with no id. Track
  // the most recent tool_use id (same strategy as the Responses translator)
  // so those messages can be attached to the call they answer.
  let lastToolUseId: string | undefined;
  for (const msg of messages) {
    if (msg.role === 'tool' && typeof msg.content === 'string') {
      if (lastToolUseId !== undefined) {
        out.push({ role: 'tool', tool_call_id: lastToolUseId, content: msg.content });
      } else {
        out.push({ role: 'user', content: msg.content });
      }
      continue;
    }
    if (typeof msg.content !== 'string') {
      for (const block of msg.content) {
        if (block.type === 'tool_use') lastToolUseId = block.id;
      }
    }
    out.push(...translateMessage(msg));
  }
  return out;
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === null) return 'null';
  if (output === undefined) return '';
  return JSON.stringify(output);
}

function translateMessage(msg: Message): OpenAIMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: msg.role, content: msg.content }];
  }

  const out: OpenAIMessage[] = [];
  let parts: OpenAIContentPart[] = [];
  let toolCalls: OpenAIToolCall[] = [];

  const flush = () => {
    if (parts.length === 0 && toolCalls.length === 0) return;
    const message: OpenAIMessage = {
      role: msg.role,
      content: parts.length > 0 ? parts : null,
    };
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    out.push(message);
    parts = [];
    toolCalls = [];
  };

  for (const block of msg.content) {
    switch (block.type) {
      case 'text':
        parts.push({ type: 'text', text: block.text });
        break;
      case 'image':
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${block.mimeType};base64,${block.data}` },
        });
        break;
      case 'tool_use':
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments:
              typeof block.arguments === 'string'
                ? block.arguments
                : JSON.stringify(block.arguments ?? {}),
          },
        });
        break;
      case 'tool_result':
        flush();
        out.push({
          role: 'tool',
          tool_call_id: block.toolUseId,
          content: stringifyToolOutput(block.output),
        });
        break;
    }
  }
  flush();
  return out;
}

export function translateTools(tools: ToolDefinition[] | undefined): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export interface BuildChatRequestOptions {
  stream: boolean;
  /**
   * OpenAI deprecated `max_tokens` in favor of `max_completion_tokens` (the
   * old name 400s on reasoning models), but other OpenAI-compatible APIs
   * (xAI, OpenRouter) still document the legacy parameter.
   */
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
}

/**
 * o-series reasoning models reject `temperature`/`top_p` outright; prefer the
 * catalog's `reasoning` flag, falling back to an id-prefix check for o-series
 * models not in the catalog (o4-mini, dated snapshots, ...).
 */
function isReasoningModel(model: string): boolean {
  const meta = findModel(model);
  if (meta?.reasoning !== undefined) return meta.reasoning;
  return /^o\d/.test(model);
}

export function buildChatRequestBody(
  req: ChatRequest,
  opts: BuildChatRequestOptions,
): OpenAIChatRequestBody {
  const body: OpenAIChatRequestBody = {
    model: req.model,
    messages: translateMessages(req.messages),
    stream: opts.stream,
  };
  const reasoningModel = isReasoningModel(req.model);
  if (req.temperature !== undefined && !reasoningModel) body.temperature = req.temperature;
  if (req.maxTokens !== undefined) {
    body[opts.maxTokensParam ?? 'max_completion_tokens'] = req.maxTokens;
  }
  if (req.topP !== undefined && !reasoningModel) body.top_p = req.topP;
  if (req.stop && req.stop.length > 0) body.stop = req.stop;
  const tools = translateTools(req.tools);
  if (tools) body.tools = tools;
  if (opts.stream) body.stream_options = { include_usage: true };
  if (req.toolChoice !== undefined) {
    const tc = translateToolChoice(req.toolChoice);
    if (tc !== undefined) body.tool_choice = tc;
  }
  if (req.responseFormat !== undefined) {
    body.response_format = translateResponseFormat(req.responseFormat);
  }
  const effort = reasoningEffort(req.reasoning);
  if (effort) body.reasoning_effort = effort;
  return body;
}

function translateToolChoice(
  choice: NonNullable<ChatRequest['toolChoice']>,
): OpenAIToolChoice | undefined {
  if (choice === 'auto' || choice === 'required' || choice === 'none') return choice;
  if (typeof choice === 'object' && typeof choice.name === 'string') {
    return { type: 'function', function: { name: choice.name } };
  }
  return undefined;
}

function translateResponseFormat(
  format: NonNullable<ChatRequest['responseFormat']>,
): OpenAIResponseFormat {
  if (format.type === 'text') return { type: 'text' };
  if (format.type === 'json_object') return { type: 'json_object' };
  return {
    type: 'json_schema',
    json_schema: {
      name: format.name ?? 'response',
      schema: format.schema as Record<string, unknown>,
    },
  };
}
