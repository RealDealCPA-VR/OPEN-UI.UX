import { z } from 'zod';
import { providerConfigSchema } from '@opencodex/core';

export const anthropicConfigSchema = providerConfigSchema.extend({
  anthropicVersion: z.string().min(1).optional(),
  beta: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
});

export type AnthropicConfig = z.infer<typeof anthropicConfigSchema>;
