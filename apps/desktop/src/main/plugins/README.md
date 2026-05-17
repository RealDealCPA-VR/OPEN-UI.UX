# main/plugins

Plugin host. Loads plugin packages from disk, validates manifests against `@opencodex/plugin-sdk`, runs them in a sandboxed VM context, and registers their contributions (tools, providers, UI panels, slash commands) with the appropriate registries.
