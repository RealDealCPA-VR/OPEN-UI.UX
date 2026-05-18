import type { ChatRequest, Message, ToolDefinition } from '@opencodex/core';

type MistralTextPart = { type: 'text'; text: string };
type MistralImagePart = { type: 'image_url'; image_url: { url: string } };
type MistralContentPart = MistralTextPart | MistralImagePart;

export interface MistralToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface MistralMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | MistralContentPart[] | null;
  tool_calls?: MistralToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface MistralTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface MistralChatRequestBody {
  model: string;
  messages: MistralMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  tools?: MistralTool[];
  stream: boolean;
}

export function translateMessages(messages: Message[]): MistralMessage[] {
  return messages.flatMap(translateMessage);
}

function translateMessage(msg: Message): MistralMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: msg.role, content: msg.content }];
  }

  const out: MistralMessage[] = [];
  let parts: MistralContentPart[] = [];
  let toolCalls: MistralToolCall[] = [];

  const flush = () => {
    if (parts.length === 0 && toolCalls.length === 0) return;
    const message: MistralMessage = {
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
          content:
            typeof block.output === 'string' ? block.output : JSON.stringify(block.output ?? ''),
        });
        break;
    }
  }
  flush();
  return out;
}

export function translateTools(tools: ToolDefinition[] | undefined): MistralTool[] | undefined {
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

export function buildChatRequestBody(
  req: ChatRequest,
  opts: { stream: boolean },
): MistralChatRequestBody {
  const body: MistralChatRequestBody = {
    model: req.model,
    messages: translateMessages(req.messages),
    stream: opts.stream,
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.topP !== undefined) body.top_p = req.topP;
  if (req.stop && req.stop.length > 0) body.stop = req.stop;
  const tools = translateTools(req.tools);
  if (tools) body.tools = tools;
  return body;
}
