# main/plugins

Plugin host. Loads plugin packages from disk, validates manifests against `@opencodex/plugin-sdk`, and registers their contributions (tools, providers, UI panels, slash commands) with the appropriate registries.

## Trust model (v1)

> ⚠️ Plugins currently execute **with full Electron main-process privileges**: full Node.js API (`fs`, `child_process`, etc.), Electron API, IPC handles, and access to the keychain (provider API keys via `keytar`). The `permissions:` array in the manifest only gates the host-helper calls (`registerRunner`, `registerTool`, etc.) — it does **not** sandbox what the plugin's module-level code can do.
>
> Only install plugins you trust to run arbitrary code on your machine. Signed plugins from a known publisher are the safe default; `acceptUnsigned: true` is for local development.
>
> Tracked as a v1 hardening item (move plugin execution into `utilityProcess.fork()` with `MessagePortMain` RPC + Node `--permission` flags) in `Todo.md` Phase 15.2.
