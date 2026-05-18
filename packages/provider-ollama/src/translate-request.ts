import type { ChatRequest, Message, ToolDefinition } from '@opencodex/core';

export interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> | string };
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
}

export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OllamaChatOptions {
  temperature?: number;
  num_predict?: number;
  top_p?: number;
  stop?: string[];
}

export interface OllamaChatRequestBody {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  tools?: OllamaTool[];
  options?: OllamaChatOptions;
  keep_alive?: string | number;
}

export function translateMessages(messages: Message[]): OllamaMessage[] {
  return messages.flatMap(translateMessage);
}

function translateMessage(msg: Message): OllamaMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: msg.role, content: msg.content }];
  }

  const out: OllamaMessage[] = [];
  let text = '';
  let images: string[] = [];
  let toolCalls: OllamaToolCall[] = [];

  const flush = (role: OllamaMessage['role'] = msg.role) => {
    if (text === '' && images.length === 0 && toolCalls.length === 0) return;
    const message: OllamaMessage = { role, content: text };
    if (images.length > 0) message.images = images;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    out.push(message);
    text = '';
    images = [];
    toolCalls = [];
  };

  for (const block of msg.content) {
    switch (block.type) {
      case 'text':
        text += block.text;
        break;
      case 'image':
        images.push(block.data);
        break;
      case 'tool_use':
        toolCalls.push({
          function: {
            name: block.name,
            arguments:
              typeof block.arguments === 'object' && block.arguments !== null
                ? (block.arguments as Record<string, unknown>)
                : typeof block.arguments === 'string'
                  ? block.arguments
                  : {},
          },
        });
        break;
      case 'tool_result': {
        flush();
        const content =
          typeof block.output === 'string' ? block.output : JSON.stringify(block.output ?? '');
        out.push({ role: 'tool', content });
        break;
      }
    }
  }
  flush();
  return out;
}

export function translateTools(tools: ToolDefinition[] | undefined): OllamaTool[] | undefined {
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
  opts: { stream: boolean; keepAlive?: string | number },
): OllamaChatRequestBody {
  const body: OllamaChatRequestBody = {
    model: req.model,
    messages: translateMessages(req.messages),
    stream: opts.stream,
  };
  const options: OllamaChatOptions = {};
  if (req.temperature !== undefined) options.temperature = req.temperature;
  if (req.maxTokens !== undefined) options.num_predict = req.maxTokens;
  if (req.topP !== undefined) options.top_p = req.topP;
  if (req.stop && req.stop.length > 0) options.stop = req.stop;
  if (Object.keys(options).length > 0) body.options = options;
  const tools = translateTools(req.tools);
  if (tools) body.tools = tools;
  if (opts.keepAlive !== undefined) body.keep_alive = opts.keepAlive;
  return body;
}
