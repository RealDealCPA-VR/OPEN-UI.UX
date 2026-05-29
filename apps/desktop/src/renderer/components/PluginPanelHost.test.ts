import { describe, expect, it, vi } from 'vitest';
import {
  HostResponseSchema,
  PanelMessageSchema,
  PluginPanelPathTraversalError,
  handlePanelMessage,
  toFileUrl,
} from './PluginPanelHost';

function makeCtx(overrides: Partial<{ pluginId: string; panelId: string }> = {}) {
  const log = vi.fn();
  return {
    pluginId: overrides.pluginId ?? 'demo-plugin',
    panelId: overrides.panelId ?? 'demo-panel',
    log,
  };
}

describe('PanelMessageSchema', () => {
  it('accepts a valid log message', () => {
    const r = PanelMessageSchema.safeParse({
      kind: 'log',
      level: 'info',
      message: 'hello',
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown log level', () => {
    const r = PanelMessageSchema.safeParse({
      kind: 'log',
      level: 'debug',
      message: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('rejects log message over 2000 chars', () => {
    const r = PanelMessageSchema.safeParse({
      kind: 'log',
      level: 'info',
      message: 'x'.repeat(2001),
    });
    expect(r.success).toBe(false);
  });

  it('accepts a request-host ping', () => {
    const r = PanelMessageSchema.safeParse({
      kind: 'request-host',
      requestId: 'abc',
      op: 'ping',
    });
    expect(r.success).toBe(true);
  });

  it('rejects request-host with unknown op', () => {
    const r = PanelMessageSchema.safeParse({
      kind: 'request-host',
      requestId: 'abc',
      op: 'eval',
    });
    expect(r.success).toBe(false);
  });

  it('rejects request-host with empty requestId', () => {
    const r = PanelMessageSchema.safeParse({
      kind: 'request-host',
      requestId: '',
      op: 'ping',
    });
    expect(r.success).toBe(false);
  });

  it('rejects messages with unknown kind', () => {
    const r = PanelMessageSchema.safeParse({ kind: 'eval', code: 'alert(1)' });
    expect(r.success).toBe(false);
  });

  it('rejects non-object payloads', () => {
    expect(PanelMessageSchema.safeParse(null).success).toBe(false);
    expect(PanelMessageSchema.safeParse('hello').success).toBe(false);
    expect(PanelMessageSchema.safeParse(42).success).toBe(false);
  });
});

describe('handlePanelMessage', () => {
  it('returns null for a log message and forwards to the logger', () => {
    const ctx = makeCtx();
    const out = handlePanelMessage({ kind: 'log', level: 'warn', message: 'oh no' }, ctx);
    expect(out).toBeNull();
    expect(ctx.log).toHaveBeenCalledWith('warn', '[plugin demo-plugin/demo-panel] oh no');
  });

  it('returns a pong host-response for ping', () => {
    const ctx = makeCtx({ pluginId: 'p1', panelId: 'panel-a' });
    const out = handlePanelMessage({ kind: 'request-host', requestId: 'r-1', op: 'ping' }, ctx);
    expect(out).not.toBeNull();
    expect(out).toMatchObject({
      kind: 'host-response',
      requestId: 'r-1',
      ok: true,
    });
    // Validate the response itself parses as a HostResponse.
    expect(HostResponseSchema.safeParse(out).success).toBe(true);
  });

  it('drops malformed payloads without calling the logger', () => {
    const ctx = makeCtx();
    const out = handlePanelMessage({ foo: 'bar' }, ctx);
    expect(out).toBeNull();
    expect(ctx.log).not.toHaveBeenCalled();
  });

  it('drops attempts to inject arbitrary HTML/scripts as a non-log kind', () => {
    const ctx = makeCtx();
    const out = handlePanelMessage({ kind: 'exec', code: 'process.exit(1)' }, ctx);
    expect(out).toBeNull();
    expect(ctx.log).not.toHaveBeenCalled();
  });
});

describe('toFileUrl', () => {
  it('builds a file URL from an absolute posix path', () => {
    expect(toFileUrl('/Users/me/plugin/panel.html')).toBe('file:///Users/me/plugin/panel.html');
  });

  it('builds a file URL from a backslash Windows path', () => {
    expect(toFileUrl('C:\\plugins\\demo\\panel.html')).toBe('file:///C:/plugins/demo/panel.html');
  });

  it('rejects parent-directory traversal segments', () => {
    expect(() => toFileUrl('/plugins/demo/../../secret.html')).toThrow(
      PluginPanelPathTraversalError,
    );
  });

  it('rejects percent-encoded traversal segments', () => {
    expect(() => toFileUrl('/plugins/demo/%2e%2e/secret.html')).toThrow(
      PluginPanelPathTraversalError,
    );
  });

  it('rejects non-file schemes', () => {
    expect(() => toFileUrl('http://evil.example/panel.html')).toThrow(
      PluginPanelPathTraversalError,
    );
    expect(() => toFileUrl('javascript:alert(1)')).toThrow(PluginPanelPathTraversalError);
  });

  it('rejects empty or non-string input', () => {
    expect(() => toFileUrl('')).toThrow(PluginPanelPathTraversalError);
  });
});
