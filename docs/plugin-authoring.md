# Plugin Authoring Guide

OpenCodex plugins are npm packages that extend the host with tools, providers, slash commands, and UI panels. The same registries that hold built-in code accept plugin contributions, so a plugin tool is indistinguishable from a built-in tool at the agent layer.

> **Status**: the plugin SDK contracts (`@opencodex/plugin-sdk`) are stable in shape; the plugin loader, VM sandbox, and install UI are **planned for v0.1**. Anything tagged "PLANNED API" below describes behavior that is specified but not yet wired in `apps/desktop`.

## What plugins can contribute

| Contribution    | Status      | Where it lands                                                  |
| --------------- | ----------- | --------------------------------------------------------------- |
| Tools           | wired       | `ToolRegistry` (same registry as `@opencodex/tools` built-ins). |
| Providers       | wired       | `ProviderRegistry` for `LLMProvider` factories.                 |
| Slash commands  | host method | `PluginHost.registerSlashCommand` (PLANNED dispatch).           |
| UI panels       | PLANNED     | sandboxed iframe with `postMessage` bridge.                     |
| Settings access | wired       | `PluginHost.getSetting` / `setSetting`.                         |

## Manifest

Every plugin ships a `opencodex.plugin.json` validated by `ManifestSchema` in `packages/plugin-sdk/src/manifest.ts:22`. The Zod schema (current shape — subject to change before v0.1):

```ts
const ManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  homepage: z.string().url().optional(),
  entry: z.string(),
  engines: z.object({ opencodex: z.string() }),
  permissions: z.array(PermissionSchema).default([]),
  contributions: ContributionSchema.default({}),
});
```

`PermissionSchema` (`manifest.ts:3`) is an enum:

```ts
'workspace.read' |
  'workspace.write' |
  'shell.execute' |
  'network.fetch' |
  'settings.read' |
  'settings.write' |
  'ui.panel';
```

`ContributionSchema` (`manifest.ts:15`) lets you declare which named tools / providers / panels / slash commands your plugin owns:

```ts
{
  tools?: string[],
  providers?: string[],
  panels?: Array<{ id: string; title: string; entry: string }>,
  slashCommands?: Array<{ name: string; entry: string }>,
}
```

Example manifest (`examples/plugins/hello-world/opencodex.plugin.json`):

```json
{
  "name": "hello-world",
  "version": "0.0.0",
  "displayName": "Hello World",
  "entry": "dist/index.js",
  "engines": { "opencodex": "^0.1.0" },
  "permissions": [],
  "contributions": {
    "tools": ["hello_world"]
  }
}
```

## Lifecycle (PLANNED API for v0.1)

1. **Install** — user picks a tarball, registry URL, or local path. The loader extracts and locates `opencodex.plugin.json`.
2. **Manifest validation** — `ManifestSchema.safeParse()` runs. Anything that fails the Zod schema is rejected before code executes.
3. **Permission grant** — OpenCodex shows the user the requested `permissions[]` and contributions. The user confirms or denies.
4. **Activation** — the loader requires the `entry` module in a sandboxed VM context and calls `activate(host)`. Contributions register with the host registries.
5. **Deactivation** — `deactivate()` is called on uninstall / disable; the host unregisters everything the plugin contributed.

## Permission model

Each permission gates one host capability:

| Permission        | Unlocks                                                                              |
| ----------------- | ------------------------------------------------------------------------------------ |
| `workspace.read`  | Tools that read files within the active workspace via `@opencodex/tools` path guard. |
| `workspace.write` | Tools that mutate files within the workspace.                                        |
| `shell.execute`   | Tools that spawn child processes (subject to the same shell sandbox as `run_shell`). |
| `network.fetch`   | Tools that perform HTTP(S) requests (subject to the `web_fetch` allowlist).          |
| `settings.read`   | `host.getSetting()`.                                                                 |
| `settings.write`  | `host.setSetting()`.                                                                 |
| `ui.panel`        | Contribute UI panels into the renderer.                                              |

If a plugin tool tries to execute a tier that's not in its `permissions[]`, the host denies the call before the tool's `execute()` runs.

Built-in tool permission tiers (`read` / `write` / `execute` / `network`) still apply on top — the approval policy will prompt the user the same way it does for `@opencodex/tools` calls. See [security-model.md](./security-model.md).

## Code example: hello-world

A minimal tool plugin. Real types from `@opencodex/plugin-sdk` and `@opencodex/core` — this is exactly the source of `examples/plugins/hello-world/src/index.ts`:

```ts
import { z } from 'zod';
import { definePlugin } from '@opencodex/plugin-sdk';
import { defineTool } from '@opencodex/core';

const input = z.object({ name: z.string().optional() });

const helloWorldTool = defineTool({
  name: 'hello_world',
  description: 'Returns a friendly greeting — proves the plugin SDK works',
  inputZod: input,
  permissionTier: 'read',
  async execute({ name }) {
    return `Hello, ${name ?? 'world'}!`;
  },
});

export default definePlugin({
  activate(host) {
    host.registerTool(helloWorldTool);
    host.logger.info('hello-world plugin activated');
  },
});
```

The `PluginHost` interface (`packages/plugin-sdk/src/host.ts:9`):

```ts
interface PluginHost {
  readonly pluginId: string;
  readonly logger: PluginLogger;

  registerTool(tool: Tool): void;
  registerProvider(provider: ProviderFactory): void;
  registerSlashCommand(name: string, handler: (args: string) => Promise<void>): void;

  getSetting<T = unknown>(key: string): Promise<T | undefined>;
  setSetting<T = unknown>(key: string, value: T): Promise<void>;
}
```

`definePlugin()` (`packages/plugin-sdk/src/plugin.ts:8`) is an identity helper for type inference — it just returns its argument. The `Plugin` shape is:

```ts
interface Plugin {
  activate(host: PluginHost): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
```

## Contributing a provider

Same idea — give the host a `ProviderFactory` (`packages/core/src/provider.ts:48`):

```ts
import { definePlugin } from '@opencodex/plugin-sdk';
import type { ProviderFactory } from '@opencodex/core';
import { z } from 'zod';

const myProvider: ProviderFactory = {
  id: 'my-provider',
  displayName: 'My Provider',
  configSchema: z.object({ apiKey: z.string().min(1) }),
  create(config) {
    return new MyProvider(config); // implements LLMProvider
  },
};

export default definePlugin({
  activate(host) {
    host.registerProvider(myProvider);
  },
});
```

See [provider-authoring.md](./provider-authoring.md) for the `LLMProvider` contract.

## Sandbox (PLANNED for v0.1)

- Plugin code runs in a Node `vm` context with a curated global surface — no `process`, no `require` outside the host-supplied module map, no direct access to the filesystem or network.
- Tools the plugin registers still execute inside the main process, but every privileged side effect (workspace read/write, shell, network) is routed through host APIs whose permission gates are checked against the manifest.
- UI panels render in sandboxed iframes; they communicate with the plugin host through `postMessage`. No Node APIs reach the panel.

If the v1 VM-context approach proves too leaky, the fallback is to host each plugin in its own Electron `utilityProcess` — the SDK contracts above were designed so that swap is invisible to plugin authors.

## Publishing

Status: PLANNED for v0.1. The intent is a public package convention (`@opencodex-plugin/*`) plus a curated index. For now, install plugins locally by pointing the loader at a folder containing a valid `opencodex.plugin.json`.
