import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetWormStateForTesting,
  appendToWorm,
  configureWormMirror,
  isWormEnabled,
  setWormEnabled,
} from './worm-mirror';
import type { ToolCallAuditRow } from '../../shared/tool-audit';

function fakeRow(overrides: Partial<ToolCallAuditRow> = {}): ToolCallAuditRow {
  return {
    id: 'id-1',
    messageId: 'm-1',
    toolName: 'read_file',
    input: { path: 'a.ts' },
    output: 'ok',
    decision: 'auto',
    isError: false,
    durationMs: 12,
    createdAt: '2026-05-28T00:00:00.000Z',
    inputTruncated: false,
    outputTruncated: false,
    triggerSource: 'user',
    runnerId: null,
    routingDecision: null,
    ...overrides,
  };
}

beforeEach(() => {
  _resetWormStateForTesting();
});

afterEach(() => {
  _resetWormStateForTesting();
});

describe('worm-mirror', () => {
  it('does nothing when disabled', () => {
    const writes: Buffer[] = [];
    configureWormMirror({
      userDataPathResolver: () => '/tmp/test',
      open: () => 99,
      write: (_fd, buf) => {
        writes.push(buf);
        return buf.length;
      },
    });
    appendToWorm(fakeRow());
    expect(writes).toHaveLength(0);
    expect(isWormEnabled()).toBe(false);
  });

  it('appends one NDJSON line per row when enabled', () => {
    const writes: Buffer[] = [];
    const openCalls: Array<{ path: unknown; flags: unknown }> = [];
    configureWormMirror({
      userDataPathResolver: () => '/tmp/test',
      open: (path, flags) => {
        openCalls.push({ path, flags });
        return 7;
      },
      write: (_fd, buf) => {
        writes.push(buf);
        return buf.length;
      },
    });
    setWormEnabled(true);
    expect(isWormEnabled()).toBe(true);

    appendToWorm(fakeRow({ id: 'a' }));
    appendToWorm(fakeRow({ id: 'b' }));

    expect(writes).toHaveLength(2);
    expect(openCalls.length).toBeGreaterThan(0);
    expect(openCalls[0]!.flags).toBe('a');
    const lines = writes.map((b) => b.toString('utf8'));
    expect(lines[0]!.endsWith('\n')).toBe(true);
    const parsed0 = JSON.parse(lines[0]!.trim()) as ToolCallAuditRow;
    const parsed1 = JSON.parse(lines[1]!.trim()) as ToolCallAuditRow;
    expect(parsed0.id).toBe('a');
    expect(parsed1.id).toBe('b');
  });

  it('toggling off stops further writes but does not throw', () => {
    const writes: Buffer[] = [];
    configureWormMirror({
      userDataPathResolver: () => '/tmp/test',
      open: () => 7,
      write: (_fd, buf) => {
        writes.push(buf);
        return buf.length;
      },
    });
    setWormEnabled(true);
    appendToWorm(fakeRow({ id: 'first' }));
    setWormEnabled(false);
    appendToWorm(fakeRow({ id: 'second' }));
    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!.toString('utf8').trim()) as ToolCallAuditRow;
    expect(parsed.id).toBe('first');
  });

  it('does not crash if open throws and reverts the toggle so future writes are skipped', () => {
    const writes: Buffer[] = [];
    configureWormMirror({
      userDataPathResolver: () => '/tmp/test',
      open: () => {
        throw new Error('disk full');
      },
      write: vi.fn((_fd: number, buf: Buffer) => {
        writes.push(buf);
        return buf.length;
      }),
    });
    expect(() => setWormEnabled(true)).not.toThrow();
    expect(isWormEnabled()).toBe(false);
    expect(() => appendToWorm(fakeRow())).not.toThrow();
    expect(writes).toHaveLength(0);
  });
});
