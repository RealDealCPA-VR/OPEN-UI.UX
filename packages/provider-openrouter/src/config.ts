import { z } from 'zod';
import { providerConfigSchema } from '@opencodex/core';

export const openRouterConfigSchema = providerConfigSchema.extend({
  referer: z.string().optional(),
  title: z.string().optional(),
});

export type OpenRouterConfig = z.infer<typeof openRouterConfigSchema>;
