import type { Tool, ToolRegistry } from '@opencodex/core';
import { logger } from '../logger';
import { getSettings } from '../storage/settings';
import { getToolRegistry } from '../tools/registry';
import { buildLocalFsTools } from './local-fs-backend';
import type { LocalFsBackendState } from './local-fs-backend';

const runtime = {
  registeredTools: [] as string[],
  toolCount: 0,
  lastError: undefined as string | undefined,
  workspaceRoot: null as string | null,
  configured: false,
};

export function getLocalFsBackendState(): LocalFsBackendState {
  const cfg = getSettings().memory.backends.localFs;
  const enabled = cfg?.enabled === true;
  const state: LocalFsBackendState = {
    enabled,
    configured: runtime.configured,
    registered: runtime.registeredTools.length > 0,
    toolCount: runtime.toolCount,
    workspaceRoot: runtime.workspaceRoot,
  };
  if (runtime.lastError !== undefined) state.lastError = runtime.lastError;
  return state;
}

export function applyLocalFsBackend(): LocalFsBackendState {
  const settings = getSettings();
  const cfg = settings.memory.backends.localFs;
  const workspaceRoot = settings.activeWorkspace;
  runtime.workspaceRoot = workspaceRoot;
  runtime.configured = workspaceRoot !== null && workspaceRoot.trim().length > 0;
  unregister();
  if (!cfg?.enabled || !runtime.configured || workspaceRoot === null) {
    return getLocalFsBackendState();
  }
  try {
    const tools = buildLocalFsTools(workspaceRoot);
    registerTools(tools);
    runtime.lastError = undefined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    runtime.lastError = msg;
    logger.warn({ err }, 'local-fs memory backend startup failed');
  }
  return getLocalFsBackendState();
}

function unregister(): void {
  const registry = getToolRegistry();
  for (const name of runtime.registeredTools) {
    registry.unregister(name);
  }
  runtime.registeredTools = [];
  runtime.toolCount = 0;
}

function registerTools(tools: Tool[]): void {
  const registry: ToolRegistry = getToolRegistry();
  const names: string[] = [];
  for (const tool of tools) {
    if (registry.has(tool.name)) {
      logger.warn({ tool: tool.name }, 'local-fs memory tool name collision; skipping');
      continue;
    }
    registry.register(tool);
    names.push(tool.name);
  }
  runtime.registeredTools = names;
  runtime.toolCount = names.length;
}
