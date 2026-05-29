import { z } from 'zod';

export const allowlistEntrySchema = z
  .string()
  .min(1)
  .max(253)
  .refine(
    (s) => /^[a-z0-9.*-]+$/i.test(s),
    'Allowlist entry must contain only letters, digits, dots, dashes, and an optional leading "*."',
  );

export const networkPolicySchema = z.object({
  localOnlyMode: z.boolean(),
  allowlist: z.array(allowlistEntrySchema),
});

export type NetworkPolicy = z.infer<typeof networkPolicySchema>;

export const setLocalOnlyModeRequestSchema = z.object({
  enabled: z.boolean(),
});

export type SetLocalOnlyModeRequest = z.infer<typeof setLocalOnlyModeRequestSchema>;

export const addAllowlistEntryRequestSchema = z.object({
  hostname: allowlistEntrySchema,
});

export type AddAllowlistEntryRequest = z.infer<typeof addAllowlistEntryRequestSchema>;

export const removeAllowlistEntryRequestSchema = z.object({
  hostname: allowlistEntrySchema,
});

export type RemoveAllowlistEntryRequest = z.infer<typeof removeAllowlistEntryRequestSchema>;

export interface NetworkPolicyChangedEvent {
  policy: NetworkPolicy;
}

export const DEFAULT_NETWORK_ALLOWLIST: readonly string[] = [
  '127.0.0.1',
  'localhost',
  '*.local',
] as const;

export const DEFAULT_NETWORK_POLICY: NetworkPolicy = {
  localOnlyMode: false,
  allowlist: [...DEFAULT_NETWORK_ALLOWLIST],
};
