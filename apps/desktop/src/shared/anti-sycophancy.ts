import { z } from 'zod';

export const antiSycophancySetRequestSchema = z.object({
  enabled: z.boolean(),
});

export type AntiSycophancySetRequest = z.infer<typeof antiSycophancySetRequestSchema>;

export interface AntiSycophancyIpcInvokeChannels {
  'anti-sycophancy:get': {
    request: void;
    response: boolean;
  };
  'anti-sycophancy:set': {
    request: AntiSycophancySetRequest;
    response: boolean;
  };
}
