import { describe, expect, it } from 'vitest';
import type { ChatEvent, LLMProvider } from '@opencodex/core';
import { extractJsonObject, generateFindings } from './findings-generator';
import type { ReviewDiff } from '../../shared/review';

function fakeDiff(): ReviewDiff {
  return {
    source: { kind: 'local-branch', base: 'main', head: 'HEAD' },
    rawDiff: 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n',
    files: [],
    baseRef: 'main',
    headRef: 'HEAD',
    prNumber: null,
    prUrl: null,
    generatedAt: '2026-05-28T00:00:00.000Z',
  };
}

function providerEmitting(events: ChatEvent[]): LLMProvider {
  return {
    id: 'fake',
    displayName: 'Fake',
    async *chat() {
      for (const e of events) yield e;
    },
    embed: async () => ({ embeddings: [], usage: { tokens: 0 } }),
    listModels: async () => [],
    capabilities: async () => undefined,
  };
}

describe('extractJsonObject', () => {
  it('returns raw JSON when input starts with {', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('extracts JSON from a fenced code block', () => {
    const text = 'Sure!\n```json\n{"a":1}\n```\nDone.';
    expect(extractJsonObject(text)).toBe('{"a":1}');
  });

  it('falls back to first { to last }', () => {
    expect(extractJsonObject('noise {"a":2} trail')).toBe('{"a":2}');
  });

  it('returns null when no braces present', () => {
    expect(extractJsonObject('no json here')).toBeNull();
  });
});

describe('generateFindings', () => {
  it('parses well-formed findings JSON from provider', async () => {
    const payload = JSON.stringify({
      findings: [
        {
          filePath: 'src/x.ts',
          startLine: 1,
          endLine: 1,
          severity: 'bug',
          title: 'Off-by-one',
          rationale: 'Loop bound is wrong',
          suggestedFix: 'i < arr.length',
          retrievedContext: [],
          prompt: 'Fix off-by-one',
        },
      ],
    });
    const provider = providerEmitting([
      { type: 'text_delta', delta: payload },
      { type: 'done', stopReason: 'end_turn' },
    ]);
    const result = await generateFindings({
      diff: fakeDiff(),
      provider,
      modelId: 'fake-model',
    });
    expect(result.warning).toBeNull();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('bug');
    expect(result.findings[0]?.filePath).toBe('src/x.ts');
    expect(typeof result.findings[0]?.id).toBe('string');
  });

  it('returns warning when provider returns non-JSON', async () => {
    const provider = providerEmitting([
      { type: 'text_delta', delta: 'I refuse.' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
    const result = await generateFindings({
      diff: fakeDiff(),
      provider,
      modelId: 'fake-model',
    });
    expect(result.findings).toEqual([]);
    expect(result.warning).toMatch(/did not return JSON/);
  });

  it('returns warning when JSON is structurally invalid', async () => {
    const provider = providerEmitting([
      { type: 'text_delta', delta: '{"findings":[{"filePath":1}]}' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
    const result = await generateFindings({
      diff: fakeDiff(),
      provider,
      modelId: 'fake-model',
    });
    expect(result.findings).toEqual([]);
    expect(result.warning).toMatch(/Failed to parse/);
  });

  it('throws on provider error event', async () => {
    const provider = providerEmitting([{ type: 'error', message: 'boom', retryable: false }]);
    await expect(
      generateFindings({ diff: fakeDiff(), provider, modelId: 'fake-model' }),
    ).rejects.toThrow(/boom/);
  });
});
