import type {
  ChatRequest,
  ContentBlock,
  Message,
  ToolDefinition,
  ToolResultBlock,
  ToolUseBlock,
} from '@opencodex/core';

type GoogleTextPart = { text: string };
type GoogleInlineDataPart = { inlineData: { mimeType: string; data: string } };
type GoogleFunctionCallPart = {
  functionCall: { id?: string; name: string; args: Record<string, unknown> };
};
type GoogleFunctionResponsePart = {
  functionResponse: { id?: string; name: string; response: Record<string, unknown> };
};
type GooglePart =
  | GoogleTextPart
  | GoogleInlineDataPart
  | GoogleFunctionCallPart
  | GoogleFunctionResponsePart;

export interface GoogleContent {
  role: 'user' | 'model';
  parts: GooglePart[];
}

export interface GoogleSystemInstruction {
  parts: GoogleTextPart[];
}

export interface GoogleFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GoogleTool {
  functionDeclarations: GoogleFunctionDeclaration[];
}

export interface GoogleGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  stopSequences?: string[];
}

export interface GoogleChatRequestBody {
  contents: GoogleContent[];
  systemInstruction?: GoogleSystemInstruction;
  tools?: GoogleTool[];
  generationConfig?: GoogleGenerationConfig;
}

export function extractSystem(messages: Message[]): {
  system: string;
  rest: Message[];
} {
  const systemParts: string[] = [];
  const rest: Message[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      if (typeof msg.content === 'string') {
        if (msg.content) systemParts.push(msg.content);
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

function blockArray(content: string | ContentBlock[]): ContentBlock[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content;
}

function collectToolUseNames(messages: Message[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    if (typeof msg.content === 'string') continue;
    for (const block of msg.content) {
      if (block.type === 'tool_use') map.set(block.id, block.name);
    }
  }
  return map;
}

function toolUsePart(block: ToolUseBlock): GoogleFunctionCallPart {
  const args = parseToolArgs(block.arguments);
  const part: GoogleFunctionCallPart = {
    functionCall: { name: block.name, args },
  };
  if (block.id) part.functionCall.id = block.id;
  return part;
}

function toolResultPart(
  block: ToolResultBlock,
  toolUseNames: Map<string, string>,
): GoogleFunctionResponsePart {
  const name = toolUseNames.get(block.toolUseId) ?? block.toolUseId;
  const response = wrapToolOutput(block.output, block.isError);
  const part: GoogleFunctionResponsePart = {
    functionResponse: { name, response },
  };
  if (block.toolUseId) part.functionResponse.id = block.toolUseId;
  return part;
}

function wrapToolOutput(output: unknown, isError: boolean | undefined): Record<string, unknown> {
  const key = isError ? 'error' : 'result';
  if (output !== null && typeof output === 'object' && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }
  return { [key]: output ?? '' };
}

function parseToolArgs(args: unknown): Record<string, unknown> {
  if (args === null || args === undefined) return {};
  if (typeof args === 'string') {
    if (args.length === 0) return {};
    try {
      const parsed: unknown = JSON.parse(args);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { value: parsed };
    } catch {
      return { value: args };
    }
  }
  if (typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return { value: args };
}

export function translateMessages(messages: Message[]): GoogleContent[] {
  const toolUseNames = collectToolUseNames(messages);
  const out: GoogleContent[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'tool') {
      const parts: GooglePart[] = [];
      for (const block of blockArray(msg.content)) {
        if (block.type === 'tool_result') {
          parts.push(toolResultPart(block, toolUseNames));
        } else if (block.type === 'text') {
          parts.push({ text: block.text });
        }
      }
      if (parts.length > 0) out.push({ role: 'user', parts });
      continue;
    }

    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
    const parts: GooglePart[] = [];
    if (typeof msg.content === 'string') {
      if (msg.content) parts.push({ text: msg.content });
    } else {
      for (const block of msg.content) {
        const part = translateBlock(block, toolUseNames);
        if (part) parts.push(part);
      }
    }
    if (parts.length > 0) out.push({ role, parts });
  }
  return out;
}

function translateBlock(
  block: ContentBlock,
  toolUseNames: Map<string, string>,
): GooglePart | undefined {
  switch (block.type) {
    case 'text':
      return { text: block.text };
    case 'image':
      return { inlineData: { mimeType: block.mimeType, data: block.data } };
    case 'tool_use':
      return toolUsePart(block);
    case 'tool_result':
      return toolResultPart(block, toolUseNames);
  }
}

export function translateTools(tools: ToolDefinition[] | undefined): GoogleTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      })),
    },
  ];
}

export function buildChatRequestBody(req: ChatRequest): GoogleChatRequestBody {
  const { system, rest } = extractSystem(req.messages);
  const body: GoogleChatRequestBody = {
    contents: translateMessages(rest),
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const tools = translateTools(req.tools);
  if (tools) body.tools = tools;
  const generationConfig: GoogleGenerationConfig = {};
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (req.maxTokens !== undefined) generationConfig.maxOutputTokens = req.maxTokens;
  if (req.topP !== undefined) generationConfig.topP = req.topP;
  if (req.stop && req.stop.length > 0) generationConfig.stopSequences = req.stop;
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
  return body;
}
