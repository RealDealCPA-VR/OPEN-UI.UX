# Plugin Registry

OpenCodex can fetch a plugin index from any URL the user configures under Settings → Plugins → Registry URL. Registries are pure JSON — there is no OpenCodex-hosted service, so anyone can publish or self-host one.

## Schema

```jsonc
{
  "schemaVersion": 1,
  "entries": [
    {
      "name": "hello-world",
      "version": "1.0.0",
      "displayName": "Hello World",
      "description": "Reference plugin",
      "author": "OpenCodex contributors",
      "license": "MIT",
      "homepage": "https://example.com/hello-world",
      "installUrl": "https://example.com/plugins/hello-world-1.0.0.tgz",
      "permissions": ["workspace.read"],
      "contributions": {
        "tools": ["hello_world"],
        "runners": [],
        "providers": [],
        "panels": [],
        "slashCommands": [],
      },
      "signature": "Base64 ed25519 signature over the manifest",
      "signer": "opencodex-official",
      "publishedAt": "2026-01-01T00:00:00Z",
      "downloads": 42,
    },
  ],
}
```

A bare array (no envelope) is also accepted for backward-compatibility with the previous prototype shape; entries that fail validation are silently dropped rather than poisoning the whole fetch.

See `apps/desktop/src/main/plugins/registry-fetcher.ts` for the exact Zod schema and validation rules.

## Fetcher behavior

`fetchPluginRegistry(url, fetchImpl?)`:

- Returns `{ entries, error }` — never throws.
- `error` is set on HTTP non-2xx, JSON parse failures, or envelope validation failures.
- Individual invalid entries inside a valid envelope are dropped without failing the whole fetch (forward-compatible: a registry that adds new optional fields stays parseable).
- Accepts an injected `fetchImpl` for tests.

## Search panel

`PluginSearchPanel` (renderer) calls `window.opencodex.plugins.fetchRegistry()` on mount and supports three filters:

1. **Free-text query** — matches `name`, `displayName`, or `description`.
2. **Contribution type** — Any / Tools / Providers / Runners / Panels.
3. **Permission filter** — substring match against `permissions[]`.

Each row shows the signed/unsigned badge and the publisher label (`signer`) when present. The Install button routes through the existing `plugins:install-from-path` consent flow.

## Hosting your own

A registry is just a static JSON file. Push the JSON to any HTTPS endpoint, then:

1. Settings → Plugins → Registry URL: paste the URL.
2. Click Search to populate the in-app browser.

For organizations: a single registry can index public plugins from multiple authors. Signers stay distinct because each entry carries its own `signature` + `signer` pair.

## Signing the entries

For end-to-end trust, generate Ed25519 keys per publisher and sign each plugin manifest with `signManifest`. See [plugin-signing.md](./plugin-signing.md) for the full flow. The registry then includes the base64 signature and the signer id so the host can verify both at fetch-render time (advisory badge) and again at install time (consent log).
