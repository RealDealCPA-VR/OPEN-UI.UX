import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listAllPluginSlashCommands = vi.fn();
const getPluginSlashCommandHandler = vi.fn();

vi.mock('./manager', () => ({
  listAllPluginSlashCommands: () => listAllPluginSlashCommands(),
  getPluginSlashCommandHandler: (pluginId: string, name: string) =>
    getPluginSlashCommandHandler(pluginId, name),
}));

vi.mock('../logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

import {
  dispatchPluginSlashCommand,
  listPluginSlashCommands,
  UnknownSlashCommandError,
} from './slash-dispatch';

beforeEach(() => {
  listAllPluginSlashCommands.mockReset();
  getPluginSlashCommandHandler.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('listPluginSlashCommands', () => {
  it('maps manager refs into descriptors', () => {
    listAllPluginSlashCommands.mockReturnValue([
      { pluginId: 'p1', pluginName: 'Plugin One', name: 'greet' },
      { pluginId: 'p2', pluginName: 'Plugin Two', name: 'deploy' },
    ]);
    expect(listPluginSlashCommands()).toEqual([
      { pluginId: 'p1', pluginName: 'Plugin One', name: 'greet' },
      { pluginId: 'p2', pluginName: 'Plugin Two', name: 'deploy' },
    ]);
  });
});

describe('dispatchPluginSlashCommand', () => {
  it('routes to the registered handler with args and returns ok', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    getPluginSlashCommandHandler.mockReturnValue(handler);
    const result = await dispatchPluginSlashCommand('p1', 'greet', 'hello world');
    expect(getPluginSlashCommandHandler).toHaveBeenCalledWith('p1', 'greet');
    expect(handler).toHaveBeenCalledWith('hello world');
    expect(result).toEqual({ ok: true });
  });

  it('throws a typed error for an unknown command', async () => {
    getPluginSlashCommandHandler.mockReturnValue(undefined);
    await expect(dispatchPluginSlashCommand('p1', 'nope', '')).rejects.toBeInstanceOf(
      UnknownSlashCommandError,
    );
  });

  it('catches a handler throw and surfaces the message', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    getPluginSlashCommandHandler.mockReturnValue(handler);
    const result = await dispatchPluginSlashCommand('p1', 'greet', '');
    expect(result).toEqual({ ok: false, error: 'boom' });
  });

  it('routes to the matching handler when several plugins register commands', async () => {
    const greet = vi.fn().mockResolvedValue(undefined);
    const deploy = vi.fn().mockResolvedValue(undefined);
    getPluginSlashCommandHandler.mockImplementation((pluginId: string, name: string) =>
      pluginId === 'p2' && name === 'deploy' ? deploy : greet,
    );
    await dispatchPluginSlashCommand('p2', 'deploy', 'prod');
    expect(deploy).toHaveBeenCalledWith('prod');
    expect(greet).not.toHaveBeenCalled();
  });
});
