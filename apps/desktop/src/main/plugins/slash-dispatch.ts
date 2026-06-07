import type {
  PluginSlashCommandDescriptor,
  RunPluginSlashCommandResult,
} from '../../shared/plugins';
import { logger } from '../logger';
import { getPluginSlashCommandHandler, listAllPluginSlashCommands } from './manager';

export class UnknownSlashCommandError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly commandName: string,
  ) {
    super(`no slash command "${commandName}" registered by plugin "${pluginId}"`);
    this.name = 'UnknownSlashCommandError';
  }
}

export function listPluginSlashCommands(): PluginSlashCommandDescriptor[] {
  return listAllPluginSlashCommands().map((c) => ({
    pluginId: c.pluginId,
    pluginName: c.pluginName,
    name: c.name,
  }));
}

export async function dispatchPluginSlashCommand(
  pluginId: string,
  name: string,
  args: string,
): Promise<RunPluginSlashCommandResult> {
  const handler = getPluginSlashCommandHandler(pluginId, name);
  if (!handler) {
    throw new UnknownSlashCommandError(pluginId, name);
  }
  try {
    await handler(args);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ pluginId, commandName: name, err }, 'plugin slash command handler threw');
    return { ok: false, error: message };
  }
}
