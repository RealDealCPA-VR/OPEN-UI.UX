import { z } from 'zod';
import type { ModelCapabilities } from '@opencodex/core';

export const openRouterModelEntrySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  context_length: z.number().int().positive().nullable().optional(),
  architecture: z
    .object({
      input_modalities: z.array(z.string()).optional(),
      output_modalities: z.array(z.string()).optional(),
      tokenizer: z.string().optional(),
    })
    .partial()
    .optional(),
  pricing: z
    .object({
      prompt: z.string().optional(),
      completion: z.string().optional(),
    })
    .partial()
    .optional(),
  supported_parameters: z.array(z.string()).optional(),
  top_provider: z
    .object({
      max_completion_tokens: z.number().int().positive().nullable().optional(),
      context_length: z.number().int().positive().nullable().optional(),
    })
    .partial()
    .optional(),
});

export type OpenRouterModelEntry = z.infer<typeof openRouterModelEntrySchema>;

export const openRouterModelsResponseSchema = z.object({
  data: z.array(z.unknown()),
});

export function parseOpenRouterModelsResponse(raw: unknown): ModelCapabilities[] {
  const top = openRouterModelsResponseSchema.safeParse(raw);
  if (!top.success) return [];
  const out: ModelCapabilities[] = [];
  for (const entry of top.data.data) {
    const parsed = openRouterModelEntrySchema.safeParse(entry);
    if (!parsed.success) continue;
    out.push(modelFromOpenRouterEntry(parsed.data));
  }
  return out;
}

function pricePerMillionFromPerToken(s: string | undefined): number | undefined {
  if (s === undefined || s === '') return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n * 1_000_000;
}

export function modelFromOpenRouterEntry(entry: OpenRouterModelEntry): ModelCapabilities {
  const inputMods = entry.architecture?.input_modalities ?? [];
  const supportsTools = (entry.supported_parameters ?? []).includes('tools');
  const ctx = entry.top_provider?.context_length ?? entry.context_length ?? 8_000;
  const maxOut = entry.top_provider?.max_completion_tokens ?? undefined;
  const inputPerM = pricePerMillionFromPerToken(entry.pricing?.prompt);
  const outputPerM = pricePerMillionFromPerToken(entry.pricing?.completion);

  const cap: ModelCapabilities = {
    id: entry.id,
    providerId: 'openrouter',
    displayName: entry.name ?? entry.id,
    contextWindow: ctx,
    toolUse: supportsTools,
    vision: inputMods.includes('image'),
    streaming: true,
    embeddings: false,
  };
  if (maxOut !== undefined) cap.maxOutputTokens = maxOut;
  if (inputPerM !== undefined && outputPerM !== undefined) {
    cap.pricing = { inputPerMillion: inputPerM, outputPerMillion: outputPerM };
  }
  return cap;
}

const KNOWN: ReadonlyArray<ModelCapabilities> = [
  {
    id: 'anthropic/claude-opus-4-7',
    providerId: 'openrouter',
    displayName: 'Claude Opus 4.7 (via OpenRouter)',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
  },
  {
    id: 'anthropic/claude-sonnet-4-6',
    providerId: 'openrouter',
    displayName: 'Claude Sonnet 4.6 (via OpenRouter)',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
  },
  {
    id: 'openai/gpt-4o',
    providerId: 'openrouter',
    displayName: 'GPT-4o (via OpenRouter)',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
  },
  {
    id: 'openai/gpt-4o-mini',
    providerId: 'openrouter',
    displayName: 'GPT-4o mini (via OpenRouter)',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
  },
  {
    id: 'google/gemini-2.5-pro',
    providerId: 'openrouter',
    displayName: 'Gemini 2.5 Pro (via OpenRouter)',
    contextWindow: 2_000_000,
    maxOutputTokens: 65_536,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
  },
  {
    id: 'google/gemini-2.5-flash',
    providerId: 'openrouter',
    displayName: 'Gemini 2.5 Flash (via OpenRouter)',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
  },
  {
    id: 'x-ai/grok-4',
    providerId: 'openrouter',
    displayName: 'Grok 4 (via OpenRouter)',
    contextWindow: 256_000,
    maxOutputTokens: 16_384,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
  },
  {
    id: 'meta-llama/llama-3.1-405b-instruct',
    providerId: 'openrouter',
    displayName: 'Llama 3.1 405B Instruct (via OpenRouter)',
    contextWindow: 128_000,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
  },
  {
    id: 'mistralai/mistral-large',
    providerId: 'openrouter',
    displayName: 'Mistral Large (via OpenRouter)',
    contextWindow: 128_000,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
  },
];

export function knownModels(): ModelCapabilities[] {
  return KNOWN.map((m) => ({ ...m }));
}

export function findModel(id: string): ModelCapabilities | undefined {
  return KNOWN.find((m) => m.id === id);
}
