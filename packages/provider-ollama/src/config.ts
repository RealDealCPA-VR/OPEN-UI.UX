import { z } from 'zod';
import { providerConfigSchema } from '@opencodex/core';

export const ollamaConfigSchema = providerConfigSchema.extend({
  keepAlive: z.union([z.string(), z.number()]).optional(),
});

export type OllamaConfig = z.infer<typeof ollamaConfigSchema>;
