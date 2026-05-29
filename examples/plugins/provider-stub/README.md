# provider-stub example

Reference plugin showing how a third-party `LLMProvider` plugs into OpenCodex
via the plugin SDK — registers a `ProviderFactory` from `activate(host)` and
echoes the last message back as streamed `text_delta` chat events.

## Manifest

```json
{
  "name": "provider-stub",
  "displayName": "Provider Stub",
  "entry": "dist/index.js",
  "engines": { "opencodex": "^0.1.0" },
  "permissions": [],
  "contributions": {
    "providers": ["echo"]
  }
}
```

## Activate snippet

```ts
import { definePlugin } from '@opencodex/plugin-sdk';
import type { ProviderFactory } from '@opencodex/core';

const echoProvider: ProviderFactory = {
  id: 'echo',
  displayName: 'Echo (example)',
  configSchema: /* zod schema */ z.object({}),
  create: () => new EchoProvider(),
};

export default definePlugin({
  activate(host) {
    host.registerProvider(echoProvider);
    host.logger.info('echo provider registered');
  },
});
```

`host.registerProvider(...)` validates the factory against the plugin SDK
contract at the runtime boundary and records it on the plugin's runtime
state. Auto-wiring into the global provider registry is a planned follow-up;
until then the host surfaces the factory via `getPluginProviderFactories(id)`
so the UI can offer it to the user explicitly.
