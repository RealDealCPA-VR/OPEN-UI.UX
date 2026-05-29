import { createPrivateKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { getSecret, setSecret } from '../storage/secrets';
import { getSettings, updateSettings } from '../storage/settings';

const PRIVATE_KEY_SECRET = 'auditLog.ed25519.private';

interface SigningKeyMaterial {
  privateKey: KeyObject;
  publicKeyPem: string;
}

let cached: SigningKeyMaterial | null = null;

/**
 * Returns the per-install Ed25519 signing key, generating it on first use.
 * Private half lives in the OS keychain; public half is mirrored into settings
 * so it's readable without keychain access (e.g. when exporting a bundle).
 */
export async function getOrCreateAuditSigningKey(): Promise<SigningKeyMaterial> {
  if (cached) return cached;

  const settings = getSettings();
  const storedPub = settings.auditPublicKeyPem ?? '';
  const storedPriv = await getSecret(PRIVATE_KEY_SECRET);

  if (storedPriv && storedPub) {
    try {
      const privateKey = createPrivateKey({ key: storedPriv, format: 'pem' });
      cached = { privateKey, publicKeyPem: storedPub };
      return cached;
    } catch {
      // fall through to regenerate if the stored material is corrupt
    }
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  await setSecret(PRIVATE_KEY_SECRET, privatePem);
  updateSettings({ auditPublicKeyPem: publicPem });
  cached = { privateKey, publicKeyPem: publicPem };
  return cached;
}

export function signAuditPayload(payload: Buffer, privateKey: KeyObject): string {
  return sign(null, payload, privateKey).toString('base64');
}

/** Test-only: reset the in-process cache. */
export function _resetSigningKeyCacheForTesting(): void {
  cached = null;
}
