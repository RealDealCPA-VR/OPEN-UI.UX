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
  const content =
    typeof block.output === 'string' ? block.output : JSON.stringify(block.output ?? '');
  const part: AnthropicToolResultPart = {
    type: 'tool_result',
    tool_use_id: block.toolUseId,
    content,
  };
  if (block.isError) part.is_error = true;
  return part;
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
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.topP !== undefined) body.top_p = req.topP;
  if (req.stop && req.stop.length > 0) body.stop_sequences = req.stop;
  return body;
}
