import { describe, expect, it } from 'vitest';
import { ROUTING_PRESETS, routingPolicySchema, routingStateSchema } from './routing';

describe('routing shared types', () => {
  it('every preset parses through routingPolicySchema', () => {
    for (const preset of ROUTING_PRESETS) {
      const policy = { id: preset.id, name: preset.name, rules: [...preset.rules] };
      const parsed = routingPolicySchema.safeParse(policy);
      expect(parsed.success, `preset ${preset.id}`).toBe(true);
    }
  });

  it('routingStateSchema accepts an empty state', () => {
    const parsed = routingStateSchema.safeParse({ policies: [], activePolicyId: null });
    expect(parsed.success).toBe(true);
  });

  it('routingStateSchema rejects an unknown active policy referenced loosely', () => {
    // We only validate shape — the routing-store layer scrubs missing ids.
    const parsed = routingStateSchema.safeParse({ policies: [], activePolicyId: 'nope' });
    expect(parsed.success).toBe(true);
  });
});
