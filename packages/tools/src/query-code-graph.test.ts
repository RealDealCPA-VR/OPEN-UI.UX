import { afterEach, describe, expect, it } from 'vitest';
import type { ToolContext } from '@opencodex/core';
import {
  getCodeGraphResolver,
  queryCodeGraphTool,
  setCodeGraphResolver,
  type CodeGraphQuery,
  type CodeGraphQueryResult,
  type CodeGraphResolver,
} from './query-code-graph';

function makeCtx(): ToolContext {
  return {
    workspaceRoot: '/ws/root',
    signal: new AbortController().signal,
    logger: { info: () => {}, error: () => {} },
  };
}

afterEach(() => {
  setCodeGraphResolver(null);
});

describe('queryCodeGraphTool', () => {
  it('forwards op/target/target2/limit + ctx.workspaceRoot to the resolver and returns its result', async () => {
    const calls: CodeGraphQuery[] = [];
    const result: CodeGraphQueryResult = {
      nodes: [{ id: 'a', label: 'a', file: 'a.ts' }],
      edges: [{ source: 'a', target: 'b', relation: 'calls', confidence: 'high' }],
    };
    const resolver: CodeGraphResolver = {
      async query(q) {
        calls.push(q);
        return result;
      },
    };
    setCodeGraphResolver(resolver);
    expect(getCodeGraphResolver()).toBe(resolver);

    const ctx = makeCtx();
    const out = await queryCodeGraphTool.execute(
      { op: 'path', target: 'foo', target2: 'bar', limit: 25 },
      ctx,
    );

    expect(out).toBe(result);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      workspaceRoot: '/ws/root',
      op: 'path',
      target: 'foo',
      target2: 'bar',
      limit: 25,
    });
    expect(calls[0]?.signal).toBe(ctx.signal);
  });

  it('returns an empty result with a note (and does not throw) when no resolver is set', async () => {
    const out = await queryCodeGraphTool.execute({ op: 'neighbors', target: 'foo' }, makeCtx());
    expect(out).toEqual({
      nodes: [],
      edges: [],
      note: 'Code graph is not available for this workspace yet.',
    });
  });

  it('rejects an unknown op at the input boundary', () => {
    const parsed = queryCodeGraphTool.inputZod.safeParse({ op: 'wat', target: 'foo' });
    expect(parsed.success).toBe(false);
  });
});
