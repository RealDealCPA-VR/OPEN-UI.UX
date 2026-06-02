import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatEvent, SubagentRunOptions } from '@opencodex/core';
import type { PluginHost } from '@opencodex/plugin-sdk';

interface FakeChild extends EventEmitter {
  stdout: EventEmitter & { setEncoding: (e: string) => void };
  stderr: EventEmitter & { setEncoding: (e: string) => void };
  stdin: { end: () => void; on: () => void };
  pid: number;
  killed: boolean;
  exitCode: number | null;
  signalCode: string | null;
  kill: () => void;
}

const harness = vi.hoisted(() => {
  const state: {
    children: FakeChild[];
    calls: Array<{ command: string; args: readonly string[]; options: { shell?: boolean } }>;
  } = { children: [], calls: [] };

  const makeStream = (): EventEmitter & { setEncoding: (e: string) => void } => {
    const s = new EventEmitter() as EventEmitter & { setEncoding: (e: string) => void };
    s.setEncoding = () => {};
    return s;
  };

  const spawnMock = (
    command: string,
    args: readonly string[],
    options: { shell?: boolean },
  ): FakeChild => {
    const child = new EventEmitter() as FakeChild;
    child.stdout = makeStream();
    child.stderr = makeStream();
    child.stdin = { end: () => {}, on: () => {} };
    child.pid = 4242;
    child.killed = false;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => {
      child.killed = true;
    };
    state.children.push(child);
    state.calls.push({ command, args, options });
    return child;
  };

  return { spawnMock, state };
});

vi.mock('node:child_process', () => ({
  spawn: harness.spawnMock,
  execFile: () => {
    throw new Error('execFile not expected in run() tests');
  },
}));

vi.mock('@opencodex/core/process/tree-kill', () => ({
  treeKill: (child: { killed: boolean }) => {
    child.killed = true;
    return Promise.resolve();
  },
}));

import { createClaudeCodeRunner } from './runner';

function makeHost(setting?: string): PluginHost {
  return {
    pluginId: 'claude-code',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerTool: vi.fn(),
    registerProvider: vi.fn(),
    registerRunner: vi.fn(),
    registerSlashCommand: vi.fn(),
    getSetting: vi.fn(async (key: string) =>
      key === 'claudeCliPath' ? (setting as never) : undefined,
    ),
    setSetting: vi.fn(),
  } as unknown as PluginHost;
}

const lastChild = (): FakeChild => {
  const c = harness.state.children.at(-1);
  if (!c) throw new Error('no child spawned');
  return c;
};

async function collect(
  iter: AsyncIterable<ChatEvent>,
  drive: (child: FakeChild) => Promise<void> | void,
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  const it = iter[Symbol.asyncIterator]();
  const first = it.next();
  for (let i = 0; i < 50 && harness.state.children.length === 0; i++) {
    await Promise.resolve();
  }
  await drive(lastChild());
  let res = await first;
  while (!res.done) {
    events.push(res.value);
    res = await it.next();
  }
  return events;
}

const baseOpts = (over: Partial<SubagentRunOptions> = {}): SubagentRunOptions => ({
  task: 'do the thing',
  workspaceRoot: '/repo',
  ...over,
});

describe('createClaudeCodeRunner().run()', () => {
  beforeEach(() => {
    harness.state.children.length = 0;
    harness.state.calls.length = 0;
  });

  it('never enables shell:true (command-injection guard)', async () => {
    const runner = createClaudeCodeRunner(makeHost('/bin/claude'));
    await collect(runner.run(baseOpts()), (child) => {
      child.emit('close', 0);
    });
    expect(harness.state.calls[0]?.options.shell).toBe(false);
    expect(harness.state.calls[0]?.args).toContain('do the thing');
  });

  it('translates NDJSON stdout into the expected ChatEvent sequence', async () => {
    const runner = createClaudeCodeRunner(makeHost('/bin/claude'));
    const events = await collect(runner.run(baseOpts()), (child) => {
      child.stdout.emit(
        'data',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}\n',
      );
      child.stdout.emit('data', '{"type":"result","usage":{"input_tokens":3,"output_tokens":5}}\n');
      child.emit('close', 0);
    });
    expect(events).toEqual([
      { type: 'text_delta', delta: 'hi' },
      { type: 'usage', inputTokens: 3, outputTokens: 5 },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('emits a terminal done on a clean exit with no output', async () => {
    const runner = createClaudeCodeRunner(makeHost('/bin/claude'));
    const events = await collect(runner.run(baseOpts()), (child) => {
      child.emit('close', 0);
    });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('emits error + done(error) on a non-zero exit', async () => {
    const runner = createClaudeCodeRunner(makeHost('/bin/claude'));
    const events = await collect(runner.run(baseOpts()), (child) => {
      child.stderr.emit('data', 'boom');
      child.emit('close', 2);
    });
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('emits error + done(error) on spawn error', async () => {
    const runner = createClaudeCodeRunner(makeHost('/bin/claude'));
    const events = await collect(runner.run(baseOpts()), (child) => {
      child.emit('error', new Error('ENOENT'));
    });
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('reports cancellation as done(cancelled), not done(error)', async () => {
    const ac = new AbortController();
    const runner = createClaudeCodeRunner(makeHost('/bin/claude'));
    const events = await collect(runner.run(baseOpts({ signal: ac.signal })), (child) => {
      ac.abort();
      child.emit('close', null);
    });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'cancelled' });
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('reports a wall-time budget kill as done(budget_exceeded)', async () => {
    vi.useFakeTimers();
    try {
      const runner = createClaudeCodeRunner(makeHost('/bin/claude'));
      const events = await collect(
        runner.run(baseOpts({ budget: { maxWallTimeMs: 10 } })),
        (child) => {
          vi.advanceTimersByTime(20);
          child.emit('close', null);
        },
      );
      expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'budget_exceeded' });
    } finally {
      vi.useRealTimers();
    }
  });
});
