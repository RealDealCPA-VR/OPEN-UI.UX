import { describe, expect, it } from 'vitest';
import type { ChatEvent } from './events';
import type { SubagentRunner, SubagentRunOptions } from './runner';
import { RunnerAlreadyRegisteredError, RunnerRegistry } from './runner-registry';

function makeRunner(id: string, displayName = id): SubagentRunner {
  return {
    id,
    displayName,
    streaming: true,
    run(_opts: SubagentRunOptions): AsyncIterable<ChatEvent> {
      async function* gen(): AsyncIterable<ChatEvent> {
        yield { type: 'done', stopReason: 'end_turn' };
      }
      return gen();
    },
  };
}

describe('RunnerRegistry', () => {
  it('registers and looks up runners', () => {
    const r = new RunnerRegistry();
    const runner = makeRunner('claude-code');
    r.register(runner);
    expect(r.has('claude-code')).toBe(true);
    expect(r.get('claude-code')).toBe(runner);
  });

  it('rejects duplicate registration with RunnerAlreadyRegisteredError', () => {
    const r = new RunnerRegistry();
    r.register(makeRunner('codex'));
    expect(() => r.register(makeRunner('codex'))).toThrow(RunnerAlreadyRegisteredError);
    try {
      r.register(makeRunner('codex'));
    } catch (err) {
      expect(err).toBeInstanceOf(RunnerAlreadyRegisteredError);
      const e = err as RunnerAlreadyRegisteredError;
      expect(e.runnerId).toBe('codex');
      expect(e.name).toBe('RunnerAlreadyRegisteredError');
    }
  });

  it('unregister returns true when removed, false when not present', () => {
    const r = new RunnerRegistry();
    r.register(makeRunner('gemini'));
    expect(r.unregister('gemini')).toBe(true);
    expect(r.unregister('gemini')).toBe(false);
  });

  it('list returns every registered runner', () => {
    const r = new RunnerRegistry();
    const a = makeRunner('a');
    const b = makeRunner('b');
    r.register(a);
    r.register(b);
    expect(r.list()).toEqual([a, b]);
  });

  it('onChange fires on register and unregister', () => {
    const r = new RunnerRegistry();
    const calls: string[] = [];
    r.onChange(() => calls.push('change'));

    r.register(makeRunner('a'));
    expect(calls).toEqual(['change']);

    r.unregister('a');
    expect(calls).toEqual(['change', 'change']);

    r.unregister('a');
    expect(calls).toEqual(['change', 'change']);
  });

  it('onChange unsubscribe stops the listener', () => {
    const r = new RunnerRegistry();
    let count = 0;
    const unsubscribe = r.onChange(() => {
      count += 1;
    });

    r.register(makeRunner('a'));
    expect(count).toBe(1);

    unsubscribe();
    r.register(makeRunner('b'));
    r.unregister('a');
    expect(count).toBe(1);
  });
});
