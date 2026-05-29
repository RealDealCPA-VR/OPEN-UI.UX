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

/**
 * Network egress policy.
 *
 * IMPORTANT: an empty `allowlist` (`[]`) with `localOnlyMode: false` means
 * "allow all hosts" — legacy behaviour preserved so existing users don't get
 * silently locked out of every cloud provider after upgrade. Callers that
 * want a deny-by-default posture must set `localOnlyMode: true` or populate
 * the allowlist. The main process logs a warning at startup when this
 * permissive mode is in effect (see `main/index.ts`).
 */
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
