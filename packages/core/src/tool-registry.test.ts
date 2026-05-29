import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { defineTool, ToolCancelledError, ToolInputError, ToolNotFoundError } from './tool';
import { ToolRegistry } from './tool-registry';

function makeCtx() {
  return {
    workspaceRoot: '/tmp',
    signal: new AbortController().signal,
    logger: { info: () => {}, error: () => {} },
  };
}

function makeEcho() {
  return defineTool({
    name: 'echo',
    description: 'returns the input',
    inputZod: z.object({ text: z.string() }),
    permissionTier: 'read',
    execute: async ({ text }) => text,
  });
}

function makeWriter() {
  return defineTool({
    name: 'writer',
    description: 'pretends to write',
    inputZod: z.object({ path: z.string() }),
    permissionTier: 'write',
    execute: async ({ path }) => ({ wrote: path }),
  });
}

describe('ToolRegistry', () => {
  it('registers and looks up tools', () => {
    const r = new ToolRegistry();
    r.register(makeEcho());
    expect(r.has('echo')).toBe(true);
    expect(r.get('echo')?.name).toBe('echo');
  });

  it('rejects duplicate registration', () => {
    const r = new ToolRegistry();
    r.register(makeEcho());
    expect(() => r.register(makeEcho())).toThrow(/already registered/);
  });

  it('unregister returns true when removed, false when not present', () => {
    const r = new ToolRegistry();
    r.register(makeEcho());
    expect(r.unregister('echo')).toBe(true);
    expect(r.unregister('echo')).toBe(false);
  });

  it('list returns ToolDefinitions without inputZod or execute', () => {
    const r = new ToolRegistry();
    r.register(makeEcho());
    const list = r.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'echo',
      description: 'returns the input',
      permissionTier: 'read',
    });
    expect(list[0]?.inputSchema.type).toBe('object');
    expect(list[0]).not.toHaveProperty('inputZod');
    expect(list[0]).not.toHaveProperty('execute');
  });

  it('listByTier filters by permission tier', () => {
    const r = new ToolRegistry();
    r.register(makeEcho());
    r.register(makeWriter());
    expect(r.listByTier('read').map((t) => t.name)).toEqual(['echo']);
    expect(r.listByTier('write').map((t) => t.name)).toEqual(['writer']);
    expect(r.listByTier('execute')).toEqual([]);
  });

  it('execute validates input via Zod and runs the tool', async () => {
    const r = new ToolRegistry();
    r.register(makeEcho());
    const result = await r.execute('echo', { text: 'hi' }, makeCtx());
    expect(result).toBe('hi');
  });

  it('execute throws ToolNotFoundError for unknown tools', async () => {
    const r = new ToolRegistry();
    await expect(r.execute('missing', {}, makeCtx())).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it('execute throws ToolInputError on invalid input', async () => {
    const r = new ToolRegistry();
    r.register(makeEcho());
    await expect(r.execute('echo', { text: 42 }, makeCtx())).rejects.toBeInstanceOf(ToolInputError);
  });

  it('execute throws ToolCancelledError without reaching execute when signal is pre-aborted', async () => {
    const r = new ToolRegistry();
    const execute = vi.fn(async ({ text }: { text: string }) => text);
    r.register(
      defineTool({
        name: 'observed',
        description: 'records whether execute ran',
        inputZod: z.object({ text: z.string() }),
        permissionTier: 'read',
        execute,
      }),
    );
    const controller = new AbortController();
    controller.abort('user-cancelled');
    const ctx = {
      workspaceRoot: '/tmp',
      signal: controller.signal,
      logger: { info: () => {}, error: () => {} },
    };
    await expect(r.execute('observed', { text: 'hi' }, ctx)).rejects.toBeInstanceOf(
      ToolCancelledError,
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
