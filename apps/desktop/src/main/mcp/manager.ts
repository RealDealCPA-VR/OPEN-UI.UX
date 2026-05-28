import {
  McpClient,
  type McpPrompt,
  type McpResource,
  type McpServerConfig,
} from '@opencodex/mcp-client';
import type {
  McpConnectionStatus,
  McpPromptEntry,
  McpResourceEntry,
  McpServerEntry,
  McpServerStatus,
  McpState,
} from '../../shared/mcp';
import { logger } from '../logger';
import { getMcpServers, setMcpServers } from '../storage/settings';
import { getToolRegistry } from '../tools/registry';
import { friendlyErrorMessage } from '../util/friendly-error';
import { emitUiError } from '../util/ui-error';
import { adaptMcpTool, mcpToolName } from './tool-adapter';

interface RuntimeState {
  client: McpClient | null;
  status: McpConnectionStatus;
  serverInfo?: { name: string; version: string };
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  prompts: McpPrompt[];
  resources: McpResource[];
  lastError?: string;
  connectedAt?: string;
  reconnectTimer?: NodeJS.Timeout;
  registeredTools: string[];
  connectStartedAt?: number;
  toastedFailure?: boolean;
}

export type ConnectedListener = (serverId: string) => void;
const connectedListeners = new Set<ConnectedListener>();

type StateListener = (state: McpState) => void;

const runtime = new Map<string, RuntimeState>();
const listeners = new Set<StateListener>();

const RECONNECT_BASE_MS = 1_500;
const RECONNECT_MAX_MS = 30_000;
const EARLY_EXIT_THRESHOLD_MS = 500;

function emit(): void {
  const state = readState();
  for (const l of listeners) l(state);
}

function ensureRuntime(id: string): RuntimeState {
  let r = runtime.get(id);
  if (!r) {
    r = {
      client: null,
      status: 'disconnected',
      toolCount: 0,
      resourceCount: 0,
      promptCount: 0,
      prompts: [],
      resources: [],
      registeredTools: [],
    };
    runtime.set(id, r);
  }
  return r;
}

function unregisterServerTools(serverId: string): void {
  const r = ensureRuntime(serverId);
  const registry = getToolRegistry();
  for (const name of r.registeredTools) registry.unregister(name);
  r.registeredTools = [];
  r.prompts = [];
  r.promptCount = 0;
  r.resources = [];
  r.resourceCount = 0;
}

function readState(): McpState {
  const servers = getMcpServers();
  const status: Record<string, McpServerStatus> = {};
  for (const s of servers) {
    const r = ensureRuntime(s.id);
    status[s.id] = {
      id: s.id,
      status: s.enabled ? r.status : 'disabled',
      ...(r.serverInfo ? { serverInfo: r.serverInfo } : {}),
      toolCount: r.toolCount,
      resourceCount: r.resourceCount,
      promptCount: r.promptCount,
      ...(r.lastError ? { lastError: r.lastError } : {}),
      ...(r.connectedAt ? { connectedAt: r.connectedAt } : {}),
    };
  }
  return { servers, status };
}

export function getMcpState(): McpState {
  return readState();
}

export function getAvailablePrompts(): McpPromptEntry[] {
  const servers = getMcpServers();
  const out: McpPromptEntry[] = [];
  for (const s of servers) {
    if (!s.enabled) continue;
    const r = ensureRuntime(s.id);
    if (r.status !== 'connected') continue;
    for (const p of r.prompts) {
      const entry: McpPromptEntry = {
        serverId: s.id,
        serverDisplayName: s.displayName,
        prompt: {
          name: p.name,
          ...(p.description !== undefined ? { description: p.description } : {}),
          ...(p.arguments !== undefined
            ? {
                arguments: p.arguments.map((a) => ({
                  name: a.name,
                  ...(a.description !== undefined ? { description: a.description } : {}),
                  ...(a.required !== undefined ? { required: a.required } : {}),
                })),
              }
            : {}),
        },
      };
      out.push(entry);
    }
  }
  return out;
}

export function getAvailableResources(): McpResourceEntry[] {
  const servers = getMcpServers();
  const out: McpResourceEntry[] = [];
  for (const s of servers) {
    if (!s.enabled) continue;
    const r = ensureRuntime(s.id);
    if (r.status !== 'connected') continue;
    for (const res of r.resources) {
      out.push({
        serverId: s.id,
        serverDisplayName: s.displayName,
        resource: {
          uri: res.uri,
          name: res.name,
          ...(res.description !== undefined ? { description: res.description } : {}),
          ...(res.mimeType !== undefined ? { mimeType: res.mimeType } : {}),
        },
      });
    }
  }
  return out;
}

export function getClientForServer(serverId: string): McpClient | null {
  return runtime.get(serverId)?.client ?? null;
}

export function onMcpStateChange(listener: StateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onMcpServerConnected(listener: ConnectedListener): () => void {
  connectedListeners.add(listener);
  return () => connectedListeners.delete(listener);
}

async function connectServer(server: McpServerEntry, attempt = 0): Promise<void> {
  const r = ensureRuntime(server.id);
  if (r.reconnectTimer) {
    clearTimeout(r.reconnectTimer);
    r.reconnectTimer = undefined;
  }
  if (r.client) {
    try {
      await r.client.disconnect();
    } catch {
      // ignore
    }
    r.client = null;
  }

  r.status = 'connecting';
  r.lastError = undefined;
  r.connectStartedAt = Date.now();
  emit();

  const client = new McpClient(server.id, server.config as McpServerConfig);
  client.onClose(() => {
    const current = ensureRuntime(server.id);
    if (current.client !== client) return;
    const startedAt = current.connectStartedAt ?? Date.now();
    const ranForMs = Date.now() - startedAt;
    current.status = 'disconnected';
    current.client = null;
    unregisterServerTools(server.id);
    emit();
    if (!server.enabled) return;
    // If the child died within the first 500ms, it almost certainly never
    // really connected (bad binary, missing dependency). Skip the fast 1.5s
    // retry and jump straight to the max backoff, and toast the user once.
    const earlyExit = ranForMs < EARLY_EXIT_THRESHOLD_MS;
    if (earlyExit && !current.toastedFailure) {
      current.toastedFailure = true;
      const detail = current.lastError ? `: ${current.lastError}` : '';
      emitUiError({
        source: 'mcp',
        severity: 'error',
        message: `MCP server "${server.displayName}" failed to start${detail}`,
        detailId: server.id,
      });
    }
    scheduleReconnect(server, attempt + 1, earlyExit);
  });

  try {
    await client.connect();
    r.client = client;
    r.status = 'connected';
    r.serverInfo = client.info?.serverInfo;
    r.connectedAt = new Date().toISOString();
    r.toastedFailure = false;
    await refreshCounts(server.id, client);
    emit();
    for (const l of connectedListeners) {
      try {
        l(server.id);
      } catch (err) {
        logger.warn({ err, serverId: server.id }, 'mcp connected listener threw');
      }
    }
  } catch (err) {
    r.status = 'error';
    r.client = null;
    r.lastError = friendlyErrorMessage(err);
    logger.warn({ err, serverId: server.id }, 'mcp connect failed');
    if (!r.toastedFailure) {
      r.toastedFailure = true;
      emitUiError({
        source: 'mcp',
        severity: 'error',
        message: `MCP server "${server.displayName}" could not connect: ${r.lastError}`,
        detailId: server.id,
      });
    }
    emit();
    if (server.enabled) scheduleReconnect(server, attempt + 1, false);
  }
}

function scheduleReconnect(server: McpServerEntry, attempt: number, earlyExit: boolean): void {
  const r = ensureRuntime(server.id);
  const delay = earlyExit
    ? RECONNECT_MAX_MS
    : Math.min(RECONNECT_BASE_MS * 2 ** Math.min(attempt, 6), RECONNECT_MAX_MS);
  r.reconnectTimer = setTimeout(() => {
    void connectServer(server, attempt);
  }, delay);
}

async function refreshCounts(serverId: string, client: McpClient): Promise<void> {
  const r = ensureRuntime(serverId);
  const registry = getToolRegistry();
  unregisterServerTools(serverId);
  try {
    const remoteTools = await client.listTools();
    r.toolCount = remoteTools.length;
    for (const remote of remoteTools) {
      const adapted = adaptMcpTool(serverId, client, remote);
      if (!registry.has(adapted.name)) {
        registry.register(adapted);
        r.registeredTools.push(adapted.name);
      } else {
        // collision — skip silently; user can rename their server id
        logger.warn({ toolName: adapted.name }, 'mcp tool name collision');
      }
    }
  } catch {
    r.toolCount = 0;
  }
  try {
    const remoteResources = await client.listResources();
    r.resources = remoteResources;
    r.resourceCount = remoteResources.length;
  } catch {
    r.resources = [];
    r.resourceCount = 0;
  }
  try {
    const remotePrompts = await client.listPrompts();
    r.prompts = remotePrompts;
    r.promptCount = remotePrompts.length;
  } catch {
    r.prompts = [];
    r.promptCount = 0;
  }
  void mcpToolName; // keep helper exported for tests
}

export async function startAllServers(): Promise<void> {
  const servers = getMcpServers();
  await Promise.all(
    servers.filter((s) => s.enabled).map((s) => connectServer(s).catch(() => undefined)),
  );
}

export async function addServer(entry: McpServerEntry): Promise<McpState> {
  const current = getMcpServers();
  if (current.some((s) => s.id === entry.id)) {
    throw new Error(`MCP server "${entry.id}" already exists`);
  }
  setMcpServers([...current, entry]);
  if (entry.enabled) await connectServer(entry);
  emit();
  return readState();
}

export async function removeServer(id: string): Promise<McpState> {
  const current = getMcpServers();
  const filtered = current.filter((s) => s.id !== id);
  setMcpServers(filtered);
  unregisterServerTools(id);
  const r = runtime.get(id);
  if (r) {
    if (r.reconnectTimer) clearTimeout(r.reconnectTimer);
    if (r.client) {
      try {
        await r.client.disconnect();
      } catch {
        // ignore
      }
    }
    runtime.delete(id);
  }
  emit();
  return readState();
}

export async function setServerEnabled(id: string, enabled: boolean): Promise<McpState> {
  const current = getMcpServers();
  const idx = current.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error(`unknown MCP server "${id}"`);
  const existing = current[idx];
  if (!existing) throw new Error(`unknown MCP server "${id}"`);
  const next: McpServerEntry = { ...existing, enabled };
  const updated = [...current];
  updated[idx] = next;
  setMcpServers(updated);
  const r = ensureRuntime(id);
  if (enabled) {
    await connectServer(next);
  } else {
    if (r.reconnectTimer) clearTimeout(r.reconnectTimer);
    unregisterServerTools(id);
    if (r.client) {
      try {
        await r.client.disconnect();
      } catch {
        // ignore
      }
    }
    r.client = null;
    r.status = 'disabled';
  }
  emit();
  return readState();
}

export function getClientFor(serverId: string): McpClient | null {
  return runtime.get(serverId)?.client ?? null;
}

export async function shutdownAllServers(): Promise<void> {
  for (const [id, r] of runtime.entries()) {
    if (r.reconnectTimer) clearTimeout(r.reconnectTimer);
    unregisterServerTools(id);
    if (r.client) {
      try {
        await r.client.disconnect();
      } catch {
        // ignore
      }
    }
  }
  runtime.clear();
}
