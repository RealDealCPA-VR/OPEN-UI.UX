import { JSONRPC_VERSION, JsonRpcError, isResponse, isNotification, isRequest } from './jsonrpc';
import { StdioTransport } from './stdio-transport';
import { SseTransport } from './sse-transport';
import { HttpTransport } from './http-transport';
import type { Transport } from './transport';
import type { McpServerConfig } from './config';
import {
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  mcpInitializeResultSchema,
  mcpListPromptsResultSchema,
  mcpListResourcesResultSchema,
  mcpListToolsResultSchema,
  mcpCallToolResultSchema,
  mcpReadResourceResultSchema,
  type McpCallToolResult,
  type McpInitializeResult,
  type McpPrompt,
  type McpReadResourceResult,
  type McpResource,
  type McpTool,
} from './protocol';

interface PendingCall {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

export type NotificationListener = (method: string, params: unknown) => void;
export type ServerRequestHandler = (method: string, params: unknown) => Promise<unknown> | unknown;

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const METHOD_NOT_FOUND = -32601;

export class UnsupportedProtocolVersionError extends Error {
  constructor(
    public readonly clientVersion: string,
    public readonly serverVersion: string,
  ) {
    super(
      `MCP server protocol version "${serverVersion}" is not supported by client "${clientVersion}"`,
    );
    this.name = 'UnsupportedProtocolVersionError';
  }
}

export class McpClient {
  private readonly transport: Transport;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly notificationListeners: NotificationListener[] = [];
  private readonly closeListeners: (() => void)[] = [];
  private readonly serverRequestHandlers = new Map<string, ServerRequestHandler>();
  private serverInfo: McpInitializeResult | null = null;
  private connected = false;

  constructor(
    public readonly serverId: string,
    config: McpServerConfig,
  ) {
    this.transport = createTransport(config);
    this.transport.onMessage((msg) => this.handleMessage(msg));
    this.transport.onClose(() => {
      this.connected = false;
      for (const pending of this.pending.values()) {
        pending.reject(new Error('MCP transport closed'));
      }
      this.pending.clear();
      for (const listener of this.closeListeners) listener();
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.transport.start();
    this.connected = true;
    const result = await this.request<unknown>('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'opencodex', version: '0.0.0' },
      capabilities: {
        sampling: {},
        elicitation: {},
      },
    });
    const parsed = mcpInitializeResultSchema.parse(result);
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(parsed.protocolVersion)) {
      this.connected = false;
      await this.transport.stop();
      throw new UnsupportedProtocolVersionError(PROTOCOL_VERSION, parsed.protocolVersion);
    }
    this.serverInfo = parsed;
    await this.notify('notifications/initialized', {});
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    await this.transport.stop();
  }

  get info(): McpInitializeResult | null {
    return this.serverInfo;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  onNotification(listener: NotificationListener): void {
    this.notificationListeners.push(listener);
  }

  setServerRequestHandler(method: string, handler: ServerRequestHandler): void {
    this.serverRequestHandlers.set(method, handler);
  }

  async listTools(): Promise<McpTool[]> {
    const result = await this.request<unknown>('tools/list', {});
    return mcpListToolsResultSchema.parse(result).tools;
  }

  async listResources(): Promise<McpResource[]> {
    const result = await this.request<unknown>('resources/list', {});
    return mcpListResourcesResultSchema.parse(result).resources;
  }

  async listPrompts(): Promise<McpPrompt[]> {
    const result = await this.request<unknown>('prompts/list', {});
    return mcpListPromptsResultSchema.parse(result).prompts;
  }

  async callTool(name: string, args: unknown): Promise<McpCallToolResult> {
    const result = await this.request<unknown>('tools/call', { name, arguments: args });
    return mcpCallToolResultSchema.parse(result);
  }

  async readResource(uri: string): Promise<McpReadResourceResult> {
    const result = await this.request<unknown>('resources/read', { uri });
    return mcpReadResourceResultSchema.parse(result);
  }

  async ping(): Promise<void> {
    await this.request<unknown>('ping', {});
  }

  private async request<T>(
    method: string,
    params: unknown,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const id = this.nextId++;
    const message = { jsonrpc: JSONRPC_VERSION, id, method, params };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        void this.notify('notifications/cancelled', {
          requestId: id,
          reason: `timeout after ${timeoutMs}ms`,
        }).catch(() => {
          // best-effort; transport may already be gone
        });
        reject(new Error(`MCP request "${method}" timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (r) => {
          clearTimeout(timer);
          reject(r);
        },
      });
      void this.transport.send(message).catch((err: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  private async notify(method: string, params: unknown): Promise<void> {
    await this.transport.send({ jsonrpc: JSONRPC_VERSION, method, params });
  }

  private handleMessage(message: unknown): void {
    if (isResponse(message)) {
      if (message.id === null) return;
      const idNum = typeof message.id === 'number' ? message.id : Number(message.id);
      const pending = this.pending.get(idNum);
      if (!pending) return;
      this.pending.delete(idNum);
      if (message.error) {
        pending.reject(
          new JsonRpcError(message.error.code, message.error.message, message.error.data),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (isRequest(message)) {
      void this.handleServerRequest(message.id, message.method, message.params);
      return;
    }
    if (isNotification(message)) {
      for (const listener of this.notificationListeners) {
        listener(message.method, message.params);
      }
    }
  }

  private async handleServerRequest(
    id: string | number,
    method: string,
    params: unknown,
  ): Promise<void> {
    const handler = this.serverRequestHandlers.get(method);
    if (!handler) {
      await this.transport
        .send({
          jsonrpc: JSONRPC_VERSION,
          id,
          error: {
            code: METHOD_NOT_FOUND,
            message: `Method not found: ${method}`,
          },
        })
        .catch(() => {
          // transport gone; nothing else to do
        });
      return;
    }
    try {
      const result = await handler(method, params);
      await this.transport.send({ jsonrpc: JSONRPC_VERSION, id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'handler failed';
      await this.transport
        .send({
          jsonrpc: JSONRPC_VERSION,
          id,
          error: { code: -32000, message },
        })
        .catch(() => {
          // best-effort
        });
    }
  }
}

function createTransport(config: McpServerConfig): Transport {
  if (config.kind === 'stdio') return new StdioTransport(config);
  if (config.kind === 'sse') return new SseTransport(config);
  return new HttpTransport(config);
}

export function createMcpClient(serverId: string, config: McpServerConfig): McpClient {
  return new McpClient(serverId, config);
}
