import { z } from 'zod';
import { providerConfigSchema } from '@opencodex/core';

export const openAIConfigSchema = providerConfigSchema.extend({
  organization: z.string().optional(),
  project: z.string().optional(),
});

export type OpenAIConfig = z.infer<typeof openAIConfigSchema>;
