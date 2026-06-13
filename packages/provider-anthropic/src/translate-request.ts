import type {
  ChatRequest,
  ContentBlock,
  Message,
  ToolDefinition,
  ToolResultBlock,
} from '@opencodex/core';
import { defaultMaxTokens } from './models';

type AnthropicTextPart = { type: 'text'; text: string };
type AnthropicImagePart = {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
};
type AnthropicToolUsePart = { type: 'tool_use'; id: string; name: string; input: unknown };
type AnthropicToolResultPart = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
type AnthropicContentPart =
  | AnthropicTextPart
  | AnthropicImagePart
  | AnthropicToolUsePart
  | AnthropicToolResultPart;

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentPart[];
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'none' }
  | { type: 'tool'; name: string };

export type AnthropicThinkingConfig =
  | { type: 'enabled'; budget_tokens: number }
  | { type: 'adaptive' };

export interface AnthropicChatRequestBody {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  tools?: AnthropicTool[];
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tool_choice?: AnthropicToolChoice;
  thinking?: AnthropicThinkingConfig;
  output_config?: { effort: 'low' | 'medium' | 'high' };
}

// Opus 4.7/4.8 and the 4.6 family only accept thinking:{type:'adaptive'} —
// the enabled+budget_tokens shape 400s on 4.7/4.8 and is deprecated on 4.6.
const ADAPTIVE_THINKING_MODELS = /^claude-(opus-4-[678]|sonnet-4-6|haiku-4-5)/;
// temperature/top_p/top_k were removed on Opus 4.7/4.8 and 400 even when
// thinking is off.
const SAMPLING_REMOVED_MODELS = /^claude-opus-4-[78]/;
// output_config.effort errors on Haiku 4.5 — Opus 4.6+ and Sonnet 4.6 only.
const EFFORT_MODELS = /^claude-(opus-4-[678]|sonnet-4-6)/;

/**
 * Map the provider-agnostic ReasoningOption to Anthropic thinking config.
 * Adaptive-thinking models get `{ type: 'adaptive' }` (no token budget).
 * Pre-4.6 models keep extended thinking: `true` → a default budget;
 * `{ maxTokens }` → that exact budget; `{ effort }` → a per-effort budget,
 * floored to the API minimum of 1024. Returns undefined when reasoning is off.
 */
export function anthropicThinking(
  reasoning: ChatRequest['reasoning'],
  model: string,
): AnthropicThinkingConfig | undefined {
  if (reasoning === undefined || reasoning === false) return undefined;
  if (ADAPTIVE_THINKING_MODELS.test(model)) return { type: 'adaptive' };
  let budget: number;
  if (reasoning === true) {
    budget = 4096;
  } else if (typeof reasoning.maxTokens === 'number') {
    budget = reasoning.maxTokens;
  } else {
    const byEffort: Record<'low' | 'medium' | 'high', number> = {
      low: 2048,
      medium: 8192,
      high: 16384,
    };
    budget = byEffort[reasoning.effort ?? 'medium'];
  }
  return { type: 'enabled', budget_tokens: Math.max(1024, Math.floor(budget)) };
}

export function extractSystem(messages: Message[]): { system: string; rest: Message[] } {
  const systemParts: string[] = [];
  const rest: Message[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      if (typeof msg.content === 'string') {
        systemParts.push(msg.content);
      } else {
        for (const block of msg.content) {
          if (block.type === 'text') systemParts.push(block.text);
        }
      }
    } else {
      rest.push(msg);
    }
  }
  return { system: systemParts.join('\n\n'), rest };
}

export function translateMessages(messages: Message[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'tool') {
      const parts = blockArray(msg.content);
      const content: AnthropicContentPart[] = [];
      for (const block of parts) {
        if (block.type === 'tool_result') {
          content.push(translateToolResult(block));
        } else if (block.type === 'text') {
          content.push({ type: 'text', text: block.text });
        }
      }
      if (content.length > 0) out.push({ role: 'user', content });
      continue;
    }
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;

    const content: AnthropicContentPart[] = [];
    if (typeof msg.content === 'string') {
      if (msg.content) content.push({ type: 'text', text: msg.content });
    } else {
      for (const block of msg.content) {
        const part = translateBlock(block);
        if (part) content.push(part);
      }
    }
    if (content.length > 0) out.push({ role: msg.role, content });
  }
  return out;
}

function blockArray(content: string | ContentBlock[]): ContentBlock[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content;
}

function translateBlock(block: ContentBlock): AnthropicContentPart | undefined {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'image':
      return {
        type: 'image',
        source: { type: 'base64', media_type: block.mimeType, data: block.data },
      };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: parseToolInput(block.arguments),
      };
    case 'tool_result':
      return translateToolResult(block);
  }
}

function translateToolResult(block: ToolResultBlock): AnthropicToolResultPart {
  const content = stringifyToolOutput(block.output);
  const part: AnthropicToolResultPart = {
    type: 'tool_result',
    tool_use_id: block.toolUseId,
    content,
  };
  if (block.isError) part.is_error = true;
  return part;
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === null) return 'null';
  if (output === undefined) return '';
  return JSON.stringify(output);
}

function parseToolInput(args: unknown): unknown {
  if (typeof args !== 'string') return args ?? {};
  if (args.length === 0) return {};
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

export function translateTools(tools: ToolDefinition[] | undefined): AnthropicTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

export function buildChatRequestBody(
  req: ChatRequest,
  opts: { stream: boolean },
): AnthropicChatRequestBody {
  const { system, rest } = extractSystem(req.messages);
  const body: AnthropicChatRequestBody = {
    model: req.model,
    messages: translateMessages(rest),
    max_tokens: req.maxTokens ?? defaultMaxTokens(req.model),
  };
  if (opts.stream) body.stream = true;
  if (system) body.system = system;
  const tools = translateTools(req.tools);
  if (tools) body.tools = tools;
  // Opus 4.7/4.8 reject sampling params outright, thinking or not.
  const samplingRemoved = SAMPLING_REMOVED_MODELS.test(req.model);
  if (req.temperature !== undefined && !samplingRemoved) body.temperature = req.temperature;
  if (req.topP !== undefined && !samplingRemoved) body.top_p = req.topP;
  if (req.stop && req.stop.length > 0) body.stop_sequences = req.stop;
  if (req.toolChoice !== undefined) {
    const tc = translateToolChoice(req.toolChoice);
    if (tc) body.tool_choice = tc;
  }
  const thinking = anthropicThinking(req.reasoning, req.model);
  if (thinking) {
    body.thinking = thinking;
    if (thinking.type === 'enabled') {
      // budget_tokens must be strictly less than max_tokens — give headroom for
      // the visible (non-thinking) output if the caller's max_tokens is too small.
      if (body.max_tokens <= thinking.budget_tokens) {
        body.max_tokens = thinking.budget_tokens + 1024;
      }
    } else if (
      typeof req.reasoning === 'object' &&
      req.reasoning.effort !== undefined &&
      EFFORT_MODELS.test(req.model)
    ) {
      body.output_config = { effort: req.reasoning.effort };
    }
    // Thinking requires default sampling params; Anthropic rejects a custom
    // temperature/top_p when thinking is on.
    delete body.temperature;
    delete body.top_p;
  }
  return body;
}

function translateToolChoice(
  choice: NonNullable<ChatRequest['toolChoice']>,
): AnthropicToolChoice | undefined {
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'required') return { type: 'any' };
  if (choice === 'none') return { type: 'none' };
  if (typeof choice === 'object' && typeof choice.name === 'string') {
    return { type: 'tool', name: choice.name };
  }
  return undefined;
}
