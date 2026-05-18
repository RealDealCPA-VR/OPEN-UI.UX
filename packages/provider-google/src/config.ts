import { z } from 'zod';
import { providerConfigSchema } from '@opencodex/core';

export const googleConfigSchema = providerConfigSchema.extend({
  apiVersion: z.string().min(1).optional(),
});

export type GoogleConfig = z.infer<typeof googleConfigSchema>;
