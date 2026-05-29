import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  PluginContractError,
  assertPluginProvider,
  assertPluginRunner,
  assertPluginTool,
} from './contracts';

describe('assertPluginTool', () => {
  it('accepts a valid tool object', () => {
    expect(() =>
      assertPluginTool({
        name: 'hello',
        description: 'd',
        permissionTier: 'read',
        inputZod: z.object({}),
        inputSchema: { type: 'object' },
        execute: async () => 'ok',
      }),
    ).not.toThrow();
  });

  it('rejects when execute is missing', () => {
    expect(() =>
      assertPluginTool({
        name: 'hello',
        description: 'd',
        permissionTier: 'read',
        inputZod: z.object({}),
        inputSchema: {},
      }),
    ).toThrow(PluginContractError);
  });

  it('rejects an unknown permissionTier', () => {
    expect(() =>
      assertPluginTool({
        name: 'hello',
        description: 'd',
        permissionTier: 'root',
        inputZod: z.object({}),
        inputSchema: {},
        execute: async () => 'ok',
      }),
    ).toThrow(PluginContractError);
  });

  it('rejects null inputZod', () => {
    expect(() =>
      assertPluginTool({
        name: 'hello',
        description: 'd',
        permissionTier: 'read',
        inputZod: null,
        inputSchema: {},
        execute: async () => 'ok',
      }),
    ).toThrow(PluginContractError);
  });
});

describe('assertPluginProvider', () => {
  it('accepts a valid provider factory', () => {
    expect(() =>
      assertPluginProvider({
        id: 'echo',
        displayName: 'Echo',
        configSchema: z.object({}),
        create: () => ({}),
      }),
    ).not.toThrow();
  });

  it('rejects when create is missing', () => {
    expect(() =>
      assertPluginProvider({
        id: 'echo',
        displayName: 'Echo',
        configSchema: z.object({}),
      }),
    ).toThrow(PluginContractError);
  });

  it('rejects empty id', () => {
    expect(() =>
      assertPluginProvider({
        id: '',
        displayName: 'Echo',
        configSchema: z.object({}),
        create: () => ({}),
      }),
    ).toThrow(PluginContractError);
  });
});

describe('assertPluginRunner', () => {
  it('accepts a valid runner with run as async generator function', () => {
    async function* run() {
      yield { type: 'done' as const, stopReason: 'end_turn' as const };
    }
    expect(() =>
      assertPluginRunner({ id: 'r', displayName: 'R', streaming: true, run }),
    ).not.toThrow();
  });

  it('rejects when run is not a function', () => {
    expect(() =>
      assertPluginRunner({ id: 'r', displayName: 'R', streaming: true, run: 'not-a-fn' }),
    ).toThrow(PluginContractError);
  });

  it('rejects when checkInstalled is not a function', () => {
    async function* run() {
      yield { type: 'done' as const, stopReason: 'end_turn' as const };
    }
    expect(() =>
      assertPluginRunner({
        id: 'r',
        displayName: 'R',
        streaming: true,
        run,
        checkInstalled: 'bogus',
      }),
    ).toThrow(PluginContractError);
  });

  it('rejects when streaming is not a boolean', () => {
    async function* run() {
      yield { type: 'done' as const, stopReason: 'end_turn' as const };
    }
    expect(() => assertPluginRunner({ id: 'r', displayName: 'R', streaming: 'yes', run })).toThrow(
      PluginContractError,
    );
  });
});
