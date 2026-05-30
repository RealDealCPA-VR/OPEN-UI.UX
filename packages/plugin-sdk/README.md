<!--
  Testing pattern: providers that ship as plugins SHOULD use the
  `assertProviderHonorsAbort` helper from `@opencodex/core/test-helpers` to
  prove their `chat()` iterator stops within 500ms of `controller.abort()`.
  Stub `globalThis.fetch` (or your transport) so no real HTTP fires, then
  call the helper — see `packages/provider-openai/src/assert-provider-honors-abort.test.ts`.
-->

# @opencodex/plugin-sdk

Manifest schema, host contract, and contribution kinds for OpenCodex plugins.
See the OpenCodex repository for full plugin-author documentation.
