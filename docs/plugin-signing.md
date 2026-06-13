# Plugin Signing

OpenCodex uses Ed25519 detached signatures to attest that a plugin — its manifest **and** its executable entry files — was published by a trusted author. Signatures are advisory for unsigned/untrusted plugins (installs are never silently blocked; the consent log records what the user accepted), but a **trusted** signature is enforced: any integrity mismatch quarantines the plugin as `tampered` and it never activates.

## Threat model

Signing protects against:

- Tampering of `opencodex.plugin.json` after the publisher built it (e.g. a CDN swap or middlebox injecting an extra permission).
- A registry that lies about which permissions a plugin declares — the manifest the host loads is what gets verified, not the registry entry.
- **Tampering of the plugin's executable code** (`dist/index.js`, panel HTML entries, slash-command entries) after signing — envelope v2 covers SHA-256 hashes of every manifest-referenced entry file, re-verified on **every activation** (install, startup `loadStoredPlugins`, enable, permission re-grant).

Signing does **not** protect against:

- A malicious build by a trusted publisher.
- Files the manifest does not reference. Use plugin permissions (`workspace.write`, `shell.execute`, etc.) to bound damage.

## Envelope shape (v2)

- Algorithm: Ed25519 (Node's built-in `crypto.sign(null, payload, key)`; no hash parameter).
- Payload: canonical JSON (sorted keys, `undefined` skipped) of an **integrity payload**: the parsed `PluginManifest` plus `{ path, sha256 }` for the entry file and every panel/command entry, files sorted by normalized forward-slash path.
- Signature encoding: base64 of the raw 64-byte signature.
- `signatureEnvelopeSchema` is a discriminated union: v2 (current) and v1 (legacy, manifest-only). **A trusted v1/raw manifest-only signature now fails closed as `tampered`** — zero hash coverage would let entry code be swapped under the old signature. Previously-signed plugins must re-sign with `signPluginDirectory`.

Trusted keys are stored per-user in `electron-store` under `trustedPublisherKeys`:

```ts
type TrustedKey = { id: string; publicKey: string }; // PEM, SPKI
```

The `id` is the human-readable signer label that surfaces in the consent log and Plugin Search panel.

## Signing a plugin

```ts
import { generateKeyPairSync } from 'node:crypto';
import { signPluginDirectory, ManifestSchema } from '@opencodex/plugin-sdk';

const { privateKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

const manifest = ManifestSchema.parse(JSON.parse(readFileSync('opencodex.plugin.json', 'utf8')));
// Hashes the entry + panel/command files referenced by the manifest, then signs.
const envelope = await signPluginDirectory(pluginDir, manifest, privateKeyPem);
writeFileSync('opencodex.plugin.sig', JSON.stringify(envelope));
```

(`signPluginEnvelope(manifest, files, key)` is the lower-level variant when you already have hashes. `signManifestEnvelope` is deprecated and still emits v1.)

Ship `opencodex.plugin.sig` alongside `opencodex.plugin.json` in the plugin directory or tarball.

## Verifying

`verifyPluginIntegrity` returns `'unsigned' | 'untrusted' | 'signed' | 'tampered'`:

- **unsigned / untrusted** — no signature, or a signature by an unknown key: the existing sideload/consent flow applies unchanged (`userAcceptedUnsigned` recorded in `pluginConsentLog`).
- **signed** — trusted key, manifest matches the payload, every referenced file's SHA-256 matches disk.
- **tampered** — trusted key but any mismatch: manifest vs payload, hash mismatch, referenced file missing, or missing hash coverage (including trusted legacy v1). The plugin is listed with status `tampered` (reason in `lastError`) and never activates; enable/grant re-run the gate.

Verification runs at install (`installPluginFromPath`) **and on every activation path** — `activatePlugin` re-reads the signature and re-hashes disk files, so startup (`loadStoredPlugins`), enable, and permission re-grant all re-check.

## Rotation

To rotate a publisher key:

1. Publish a new signed manifest under the new key.
2. Add the new public key to `trustedPublisherKeys` in Settings → Plugins.
3. Once all in-the-wild plugins have rotated, remove the old key.

There is intentionally no central revocation list — OpenCodex is local-first.

## Tests

See `packages/plugin-sdk/src/signing.test.ts` (v2 round-trip over a real plugin dir, tamper/missing-file/missing-coverage → `tampered`, legacy v1 fail-closed, untrusted-key behavior) and the signing describe blocks in `apps/desktop/src/main/plugins/manager.test.ts` (install/startup/enable re-verification, quarantine).
