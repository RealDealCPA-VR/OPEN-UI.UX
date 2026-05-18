import { z } from 'zod';
import type { ChatEvent } from './events';
import type { Message } from './message';
import type { ModelCapabilities } from './capabilities';
import type { ToolDefinition } from './tool';

export interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  signal?: AbortSignal;
}

export interface EmbedRequest {
  model: string;
  inputs: string[];
  signal?: AbortSignal;
}

export interface EmbedResult {
  embeddings: number[][];
  usage: { tokens: number };
}

export interface LLMProvider {
  readonly id: string;
  readonly displayName: string;

  chat(req: ChatRequest): AsyncIterable<ChatEvent>;
  embed(req: EmbedRequest): Promise<EmbedResult>;

  listModels(): Promise<ModelCapabilities[]>;
  capabilities(model: string): Promise<ModelCapabilities | undefined>;
}

export const providerConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export interface ProviderFactory<TConfig extends ProviderConfig = ProviderConfig> {
  readonly id: string;
  readonly displayName: string;
  readonly configSchema: z.ZodType<TConfig>;
  create(config: TConfig): LLMProvider;
}
