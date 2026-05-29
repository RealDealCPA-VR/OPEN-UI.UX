# Plugin Signing

OpenCodex uses Ed25519 detached signatures to attest that a plugin manifest was published by a trusted author. Signatures are advisory — installs are never silently blocked. Instead, OpenCodex records a clear consent log so the user always knows whether the plugin they enabled was signed.

## Threat model

Signing protects against:

- Tampering of `opencodex.plugin.json` after the publisher built it (e.g. a CDN swap or middlebox injecting an extra permission).
- A registry that lies about which permissions a plugin declares — the manifest the host loads is what gets verified, not the registry entry.

Signing does **not** protect against:

- A malicious build by a trusted publisher.
- A compromised plugin entry point (`dist/index.js`). Use plugin permissions (`workspace.write`, `shell.execute`, etc.) to bound damage.

## Key shape

- Algorithm: Ed25519 (Node's built-in `crypto.sign(null, payload, key)`; no hash parameter).
- Payload: canonical JSON of the parsed `PluginManifest` (sorted keys, `undefined` skipped).
- Signature encoding: base64 of the raw 64-byte signature.

Trusted keys are stored per-user in `electron-store` under `trustedPublisherKeys`:

```ts
type TrustedKey = { id: string; publicKey: string }; // PEM, SPKI
```

The `id` is the human-readable signer label that surfaces in the consent log and Plugin Search panel.

## Signing a manifest

```ts
import { generateKeyPairSync } from 'node:crypto';
import { signManifest, ManifestSchema } from '@opencodex/plugin-sdk';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

const manifest = ManifestSchema.parse(JSON.parse(readFileSync('opencodex.plugin.json', 'utf8')));
const signature = signManifest(manifest, privateKeyPem);
writeFileSync('opencodex.plugin.sig', signature);
```

Ship `opencodex.plugin.sig` alongside `opencodex.plugin.json` in the plugin directory or tarball.

## Verifying at install time

`installPluginFromPath` in `apps/desktop/src/main/plugins/manager.ts`:

1. Reads `opencodex.plugin.json` (existing `readManifest`).
2. Reads `opencodex.plugin.sig` if present.
3. Calls `verifyManifest(manifest, signature, trustedPublisherKeys)`.
4. Appends a `pluginConsentLog` entry with `{ signed, signer, userAcceptedUnsigned }`.

A failed verification does not abort the install — it logs a warning and records `signed: false` in the consent log. The Plugins panel surfaces this status next to each installed plugin.

## Rotation

To rotate a publisher key:

1. Publish a new signed manifest under the new key.
2. Add the new public key to `trustedPublisherKeys` in Settings → Plugins.
3. Once all in-the-wild plugins have rotated, remove the old key.

There is intentionally no central revocation list — OpenCodex is local-first.

## Tests

See `packages/plugin-sdk/src/signing.test.ts` for the round-trip + tamper-detection coverage.
