import { z } from 'zod';

export const modelPricingSchema = z.object({
  inputPerMillion: z.number().nonnegative(),
  outputPerMillion: z.number().nonnegative(),
  cachedInputPerMillion: z.number().nonnegative().optional(),
});

export const modelCapabilitiesSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  displayName: z.string().min(1),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive().optional(),
  toolUse: z.boolean(),
  vision: z.boolean(),
  streaming: z.boolean(),
  embeddings: z.boolean(),
  promptCaching: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  pricing: modelPricingSchema.optional(),
});

export type ModelPricing = z.infer<typeof modelPricingSchema>;
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;
