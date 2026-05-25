# MCP Integration

OpenCodex is MCP-native: every connected Model Context Protocol server appears in the same tool registry as built-in tools, the same resource pool as RAG sources, and the same slash-command list as built-in chat commands.

> **Status**: client scaffolding (`@opencodex/mcp-client`) ships the manifest, transport interface, and client surface. Transport implementations and the wiring that surfaces server contributions to the agent loop are **planned for v0.1** — `packages/mcp-client/src/client.ts:27` currently throws `Not implemented — Phase 2.5 MCP task`.

## What MCP is

The **Model Context Protocol** is an open JSON-RPC protocol that lets LLM hosts pull tools, resources, and prompts from external "servers" without baking the integrations into the host. A filesystem server, a GitHub server, a SQLite server, a Brave Search server — all speak the same protocol and plug into any MCP-compatible client. See <https://modelcontextprotocol.io>.

OpenCodex treats MCP servers as peers of built-in tools: the agent doesn't know or care whether `read_file` is `@opencodex/tools` or an MCP filesystem server.

## How OpenCodex consumes MCP

When a server connects, its capabilities flow into existing registries:

- `tools/list` → registered with the `ToolRegistry` (`packages/core/src/tool-registry.ts:10`) under a namespaced name (`<serverId>.<toolName>`).
- `resources/list` → fed to the RAG retriever as an additional source.
- `prompts/list` → surfaced as `/`-prefixed commands in the chat input.
- `completion/complete` → hooked into the chat composer's autocomplete (PLANNED).

No special path inside the agent loop. The agent calls a tool through the registry; the registry dispatches to an `McpClient` (`packages/mcp-client/src/client.ts:17`); the client speaks JSON-RPC over the configured transport.

## Configuring a server

Servers are configured per-workspace (and optionally globally). The config schema is a Zod discriminated union (`packages/mcp-client/src/config.ts:23`):

```ts
const McpServerConfig = z.discriminatedUnion('kind', [
  StdioServerConfig,
  SseServerConfig,
  HttpServerConfig,
]);
```

### Transport: stdio

For local servers (spawned subprocess that speaks JSON-RPC on stdin/stdout).

```ts
{
  kind: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/workspace'],
  env: { /* optional */ },
  cwd: '/path/to/workspace' // optional
}
```

Schema: `StdioServerConfig` (`packages/mcp-client/src/config.ts:3`). Status: planned for v0.1.

### Transport: SSE

For remote servers that push events over HTTP Server-Sent Events.

```ts
{
  kind: 'sse',
  url: 'https://my-server.example.com/sse',
  headers: { authorization: 'Bearer ...' } // optional
}
```

Schema: `SseServerConfig` (`packages/mcp-client/src/config.ts:11`). Status: planned for v0.1.

### Transport: HTTP (streamable)

For remote servers that speak the new MCP "streamable HTTP" transport (chunked HTTP with JSON-RPC framing).

```ts
{
  kind: 'http',
  url: 'https://my-server.example.com/mcp',
  headers: { authorization: 'Bearer ...' }
}
```

Schema: `HttpServerConfig` (`packages/mcp-client/src/config.ts:17`). Status: planned for v0.1.

The transport interface itself is already defined (`packages/mcp-client/src/transport.ts:3`):

```ts
interface Transport {
  readonly kind: TransportKind; // 'stdio' | 'sse' | 'http'
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: unknown): Promise<void>;
  onMessage(handler: (message: unknown) => void): void;
  onClose(handler: () => void): void;
}
```

## The four contribution types

### Tools

Each `tools/list` entry becomes a `Tool` (`packages/core/src/tool.ts:22`) in the registry. Input schemas come from the MCP server's declared JSON Schema; the client wraps them so they look identical to a `defineTool()` output. Calls go through the **same approval gateway** as built-in tools — see [security-model.md](./security-model.md). MCP tools inherit a default permission tier of `execute` (network call to a server you don't control), overridable per-server in workspace config.

### Resources

`resources/list` entries are URIs the model can read on demand. The `McpClient.readResource(uri)` method (`packages/mcp-client/src/client.ts:24`) returns `{ mimeType, text?, blob? }`. Resources also feed the RAG retriever so they show up in codebase chat without being explicitly named.

### Prompts

`prompts/list` entries surface as slash commands. A user typing `/my-prompt arg1=foo` expands to the server's templated prompt and seeds the next turn.

### Completion

`completion/complete` is an MCP capability that lets servers provide argument autocompletion (e.g. enum values for a tool parameter). OpenCodex will wire this into the chat composer. Status: planned for v0.1.

## Per-workspace enablement and OAuth

- **Per-workspace enablement**: status: planned for v0.1. Servers will be enable-by-default per-workspace; a UI toggle in Settings → MCP can disable any server for the current workspace without removing config.
- **OAuth for remote servers**: status: planned for v0.1. The MCP spec describes an OAuth 2.0 + PKCE flow for SSE/HTTP servers. OpenCodex will store the resulting access token in `keytar` (same mechanism as provider API keys).

## Curated presets shipped with v0.1

A small set of presets ships in the desktop app so users can add common servers with one click. PLANNED for v0.1:

- **filesystem** — `@modelcontextprotocol/server-filesystem`, stdio. Scoped to the active workspace root.
- **github** — `@modelcontextprotocol/server-github`, stdio. Requires a GitHub PAT (stored in `keytar`).
- **brave-search** — `@modelcontextprotocol/server-brave-search`, stdio. Requires a Brave API key.
- **sqlite** — `@modelcontextprotocol/server-sqlite`, stdio. Pointed at a database file inside the workspace.

Adding a preset writes a `McpServerConfig` entry to the workspace's settings under `.opencodex/mcp.json` (location subject to change).

## Lifecycle

1. **Add server** — user fills out preset or custom config; OpenCodex validates with `McpServerConfig.safeParse()`.
2. **Connect** — `createMcpClient(serverId, config)` (`packages/mcp-client/src/client.ts:27`) spawns the transport, runs the JSON-RPC `initialize` handshake.
3. **Enumerate** — client fetches `tools/list`, `resources/list`, `prompts/list`.
4. **Register** — each tool registers with the `ToolRegistry`; resources/prompts wire into their respective subsystems.
5. **Use** — agent calls flow through the same approval system; tool output returns to the agent loop.
6. **Disconnect** — `disconnect()` unregisters all contributions and stops the transport.

## Trust boundaries

- **stdio**: trust depends on the binary you spawn. OpenCodex passes only the user-configured `env`, never the parent's full environment.
- **SSE / HTTP**: TLS-only; the server can see every tool argument you send it. Treat remote MCP servers like any external API — only connect to ones you trust.
- **All transports**: outputs are still subject to OpenCodex's per-tool approval policy. An MCP server cannot bypass the approval gateway.
