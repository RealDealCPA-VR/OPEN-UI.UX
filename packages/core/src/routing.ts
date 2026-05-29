import { z } from 'zod';

export const routingRuleWhenSchema = z.enum([
  'tool_call',
  'reasoning',
  'embedding',
  'sensitive_path',
]);

export type RoutingRuleWhen = z.infer<typeof routingRuleWhenSchema>;

export const providerModelRefSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
});

export type ProviderModelRef = z.infer<typeof providerModelRefSchema>;

export const routingRuleSchema = z.object({
  id: z.string().min(1),
  when: routingRuleWhenSchema,
  use: providerModelRefSchema,
  fallback: providerModelRefSchema.optional(),
});

export type RoutingRule = z.infer<typeof routingRuleSchema>;

export const routingPolicySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rules: z.array(routingRuleSchema).default([]),
});

export type RoutingPolicy = z.infer<typeof routingPolicySchema>;

export interface RoutingDecision {
  matched: RoutingRuleWhen | null;
  ruleId: string | null;
  providerId: string;
  modelId: string;
  usedFallback: boolean;
}

export const routingDecisionSchema = z.object({
  matched: routingRuleWhenSchema.nullable(),
  ruleId: z.string().nullable(),
  providerId: z.string(),
  modelId: z.string(),
  usedFallback: z.boolean(),
});

export function findRuleFor(
  policy: RoutingPolicy,
  trait: RoutingRuleWhen,
): RoutingRule | undefined {
  return policy.rules.find((r) => r.when === trait);
}
