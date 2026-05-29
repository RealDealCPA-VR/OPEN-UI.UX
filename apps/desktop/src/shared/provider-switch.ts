import { z } from 'zod';

export const resendStrategySchema = z.enum(['full-history', 'summary-only']);
export type ResendStrategy = z.infer<typeof resendStrategySchema>;

export const switchProviderRequestSchema = z.object({
  conversationId: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  resendStrategy: resendStrategySchema,
});

export type SwitchProviderRequest = z.infer<typeof switchProviderRequestSchema>;

export interface SwitchProviderResponse {
  conversationId: string;
  providerId: string;
  modelId: string;
  resendStrategy: ResendStrategy;
  summary: string | null;
}

export const switchProviderChangedEventSchema = z.object({
  conversationId: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  resendStrategy: resendStrategySchema,
});

export type ProviderSwitchChangedEvent = z.infer<typeof switchProviderChangedEventSchema>;

export const estimateCostsAcrossProvidersRequestSchema = z.object({
  conversationId: z.string().min(1),
});

export type EstimateCostsAcrossProvidersRequest = z.infer<
  typeof estimateCostsAcrossProvidersRequestSchema
>;

export interface ProviderCostEstimate {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  estimatedCostUsd: number;
  knownPricing: boolean;
}

export interface EstimateCostsAcrossProvidersResponse {
  conversationId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimates: ProviderCostEstimate[];
}
