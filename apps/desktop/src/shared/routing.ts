import { z } from 'zod';
import {
  providerModelRefSchema,
  routingPolicySchema,
  routingRuleSchema,
  routingRuleWhenSchema,
  type ProviderModelRef,
  type RoutingPolicy,
  type RoutingRule,
  type RoutingRuleWhen,
} from '@opencodex/core';

export type { ProviderModelRef, RoutingPolicy, RoutingRule, RoutingRuleWhen };

export { providerModelRefSchema, routingPolicySchema, routingRuleSchema, routingRuleWhenSchema };

export interface RoutingState {
  policies: RoutingPolicy[];
  activePolicyId: string | null;
}

export const routingStateSchema = z.object({
  policies: z.array(routingPolicySchema),
  activePolicyId: z.string().nullable(),
});

export const createRoutingPolicyRequestSchema = z.object({
  policy: routingPolicySchema,
});

export type CreateRoutingPolicyRequest = z.infer<typeof createRoutingPolicyRequestSchema>;

export const updateRoutingPolicyRequestSchema = z.object({
  id: z.string().min(1),
  patch: routingPolicySchema.partial(),
});

export type UpdateRoutingPolicyRequest = z.infer<typeof updateRoutingPolicyRequestSchema>;

export const deleteRoutingPolicyRequestSchema = z.object({
  id: z.string().min(1),
});

export type DeleteRoutingPolicyRequest = z.infer<typeof deleteRoutingPolicyRequestSchema>;

export const setActiveRoutingPolicyRequestSchema = z.object({
  id: z.string().nullable(),
});

export type SetActiveRoutingPolicyRequest = z.infer<typeof setActiveRoutingPolicyRequestSchema>;

export interface RoutingPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly rules: ReadonlyArray<RoutingRule>;
}

export const ROUTING_PRESETS: ReadonlyArray<RoutingPreset> = [
  {
    id: 'cheap-and-fast',
    name: 'Cheap and fast',
    description:
      'Route tool calls and embeddings to small/local models; keep nothing on a frontier tier.',
    rules: [
      { id: 'tool', when: 'tool_call', use: { providerId: 'openai', modelId: 'gpt-4o-mini' } },
      { id: 'reason', when: 'reasoning', use: { providerId: 'openai', modelId: 'gpt-4o-mini' } },
      {
        id: 'embed',
        when: 'embedding',
        use: { providerId: 'openai', modelId: 'text-embedding-3-small' },
      },
    ],
  },
  {
    id: 'frontier-only',
    name: 'Frontier only',
    description: 'Send everything to a single top-tier model. Highest quality, highest cost.',
    rules: [
      {
        id: 'tool',
        when: 'tool_call',
        use: { providerId: 'anthropic', modelId: 'claude-opus-4-7' },
      },
      {
        id: 'reason',
        when: 'reasoning',
        use: { providerId: 'anthropic', modelId: 'claude-opus-4-7' },
      },
    ],
  },
  {
    id: 'local-only',
    name: 'Local only',
    description:
      'Keep everything on the local runner (Ollama or similar). No outbound network for inference.',
    rules: [
      { id: 'tool', when: 'tool_call', use: { providerId: 'ollama', modelId: 'qwen2.5-coder' } },
      { id: 'reason', when: 'reasoning', use: { providerId: 'ollama', modelId: 'qwen2.5-coder' } },
      {
        id: 'embed',
        when: 'embedding',
        use: { providerId: 'ollama', modelId: 'nomic-embed-text' },
      },
      {
        id: 'sensitive',
        when: 'sensitive_path',
        use: { providerId: 'ollama', modelId: 'qwen2.5-coder' },
      },
    ],
  },
  {
    id: 'hybrid',
    name: 'Hybrid',
    description:
      'Reasoning on a frontier model, tool calls on a small model, embeddings local. Sensitive paths stay local.',
    rules: [
      { id: 'tool', when: 'tool_call', use: { providerId: 'openai', modelId: 'gpt-4o-mini' } },
      {
        id: 'reason',
        when: 'reasoning',
        use: { providerId: 'anthropic', modelId: 'claude-opus-4-7' },
      },
      {
        id: 'embed',
        when: 'embedding',
        use: { providerId: 'ollama', modelId: 'nomic-embed-text' },
      },
      {
        id: 'sensitive',
        when: 'sensitive_path',
        use: { providerId: 'ollama', modelId: 'qwen2.5-coder' },
      },
    ],
  },
];

export interface RoutingChangedEvent {
  state: RoutingState;
}
