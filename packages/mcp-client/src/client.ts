import { JSONRPC_VERSION, JsonRpcError, isResponse, isNotification } from './jsonrpc';
import { StdioTransport } from './stdio-transport';
import { SseTransport } from './sse-transport';
import { HttpTransport } from './http-transport';
import type { Transport } from './transport';
import type { McpServerConfig } from './config';
import {
  PROTOCOL_VERSION,
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

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class McpClient {
  private readonly transport: Transport;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private notificationListener: NotificationListener | null = null;
  private serverInfo: McpInitializeResult | null = null;
  private connected = false;
  private closeListener: (() => void) | null = null;

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
      this.closeListener?.();
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.transport.start();
    this.connected = true;
    const result = await this.request<unknown>('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'opencodex', version: '0.0.0' },
      capabilities: {},
    });
    this.serverInfo = mcpInitializeResultSchema.parse(result);
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
    this.closeListener = listener;
  }

  onNotification(listener: NotificationListener): void {
    this.notificationListener = listener;
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
    if (isNotification(message)) {
      this.notificationListener?.(message.method, message.params);
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
