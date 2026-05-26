import { ObsidianMemory } from '@opencodex/memory-obsidian';
import { NotionMemory } from '@opencodex/memory-notion';
import type { ToolRegistry, Tool } from '@opencodex/core';
import { logger } from '../logger';
import { getMemoryConfig, setMemoryConfig } from '../storage/settings';
import { deleteSecret, getSecret, setSecret } from '../storage/secrets';
import { getToolRegistry } from '../tools/registry';
import type {
  MemoryBackendId,
  MemoryBackendStatus,
  MemoryConfig,
  MemoryStatus,
  TestConnectionResult,
} from '../../shared/memory';

export const NOTION_TOKEN_SECRET = 'memory.notion.token';

interface BackendRuntime {
  registeredTools: string[];
  toolCount: number;
  lastError?: string;
  configured: boolean;
}

type ChangeListener = (status: MemoryStatus) => void;

const runtime: Record<MemoryBackendId, BackendRuntime> = {
  obsidian: { registeredTools: [], toolCount: 0, configured: false },
  notion: { registeredTools: [], toolCount: 0, configured: false },
};

const listeners = new Set<ChangeListener>();
let started = false;

export function onMemoryConfigChange(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function emitChange(): Promise<void> {
  const status = await getMemoryStatus();
  for (const l of listeners) {
    try {
      l(status);
    } catch (err) {
      logger.warn({ err }, 'memory listener threw');
    }
  }
}

function unregisterBackend(backendId: MemoryBackendId): void {
  const registry = getToolRegistry();
  for (const name of runtime[backendId].registeredTools) {
    registry.unregister(name);
  }
  runtime[backendId].registeredTools = [];
  runtime[backendId].toolCount = 0;
}

function registerTools(backendId: MemoryBackendId, tools: Tool[]): void {
  const registry: ToolRegistry = getToolRegistry();
  const names: string[] = [];
  for (const tool of tools) {
    if (registry.has(tool.name)) {
      logger.warn({ tool: tool.name, backendId }, 'memory tool name collision; skipping');
      continue;
    }
    registry.register(tool);
    names.push(tool.name);
  }
  runtime[backendId].registeredTools = names;
  runtime[backendId].toolCount = names.length;
}

async function applyObsidian(config: MemoryConfig): Promise<void> {
  const cfg = config.backends.obsidian;
  runtime.obsidian.configured = cfg.vaultPath.trim().length > 0;
  unregisterBackend('obsidian');
  if (!cfg.enabled || !runtime.obsidian.configured) return;
  try {
    const mem = new ObsidianMemory({ vaultPath: cfg.vaultPath });
    registerTools('obsidian', mem.buildTools());
    delete runtime.obsidian.lastError;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    runtime.obsidian.lastError = msg;
    logger.warn({ err }, 'obsidian memory startup failed');
  }
}

async function applyNotion(config: MemoryConfig): Promise<void> {
  const cfg = config.backends.notion;
  const token = (await getSecret(NOTION_TOKEN_SECRET)) ?? null;
  runtime.notion.configured = token !== null && token.length > 0;
  unregisterBackend('notion');
  if (!cfg.enabled || !runtime.notion.configured || token === null) return;
  try {
    const opts: { token: string; workspaceName?: string } = { token };
    if (cfg.workspaceName !== undefined) opts.workspaceName = cfg.workspaceName;
    const mem = new NotionMemory(opts);
    registerTools('notion', mem.buildTools());
    delete runtime.notion.lastError;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    runtime.notion.lastError = msg;
    logger.warn({ err }, 'notion memory startup failed');
  }
}

export async function startMemory(): Promise<void> {
  started = true;
  await reloadMemory();
}

export async function reloadMemory(): Promise<MemoryStatus> {
  const config = getMemoryConfig();
  await applyObsidian(config);
  await applyNotion(config);
  await emitChange();
  return getMemoryStatus();
}

export async function stopMemory(): Promise<void> {
  if (!started) return;
  unregisterBackend('obsidian');
  unregisterBackend('notion');
  started = false;
}

export function getMemoryConfigSnapshot(): MemoryConfig {
  return getMemoryConfig();
}

export async function getMemoryStatus(): Promise<MemoryStatus> {
  const config = getMemoryConfig();
  const token = await getSecret(NOTION_TOKEN_SECRET);
  const backends: MemoryBackendStatus[] = (['obsidian', 'notion'] as const).map((id) => {
    const enabled = config.backends[id].enabled;
    const configured =
      id === 'obsidian'
        ? config.backends.obsidian.vaultPath.trim().length > 0
        : token !== null && token.length > 0;
    const r = runtime[id];
    const status: MemoryBackendStatus = {
      id,
      enabled,
      configured,
      registered: r.registeredTools.length > 0,
      toolCount: r.toolCount,
    };
    if (r.lastError !== undefined) status.lastError = r.lastError;
    return status;
  });
  return {
    config,
    hasNotionToken: token !== null && token.length > 0,
    backends,
  };
}

export async function applyMemoryConfig(config: MemoryConfig): Promise<MemoryStatus> {
  setMemoryConfig(config);
  return reloadMemory();
}

export async function setNotionToken(token: string): Promise<MemoryStatus> {
  await setSecret(NOTION_TOKEN_SECRET, token);
  return reloadMemory();
}

export async function clearNotionToken(): Promise<MemoryStatus> {
  await deleteSecret(NOTION_TOKEN_SECRET);
  return reloadMemory();
}

export async function testMemoryConnection(
  backend: MemoryBackendId,
): Promise<TestConnectionResult> {
  const config = getMemoryConfig();
  if (backend === 'obsidian') {
    const cfg = config.backends.obsidian;
    if (cfg.vaultPath.trim().length === 0) {
      return { ok: false, error: 'vaultPath is not configured' };
    }
    try {
      const mem = new ObsidianMemory({ vaultPath: cfg.vaultPath });
      const r = await mem.testConnection();
      if (!r.ok) {
        const out: TestConnectionResult = { ok: false };
        if (r.error !== undefined) out.error = r.error;
        return out;
      }
      const out: TestConnectionResult = { ok: true };
      if (r.noteCount !== undefined) out.detail = { noteCount: r.noteCount };
      return out;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  const token = await getSecret(NOTION_TOKEN_SECRET);
  if (token === null || token.length === 0) {
    return { ok: false, error: 'Notion token is not set' };
  }
  try {
    const mem = new NotionMemory({ token });
    const r = await mem.testConnection();
    if (!r.ok) {
      const out: TestConnectionResult = { ok: false };
      if (r.error !== undefined) out.error = r.error;
      return out;
    }
    const out: TestConnectionResult = { ok: true };
    if (r.user?.name) out.detail = { userName: r.user.name };
    return out;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
