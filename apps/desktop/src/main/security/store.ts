import {
  DEFAULT_NETWORK_POLICY,
  networkPolicySchema,
  type NetworkPolicy,
} from '../../shared/network-policy';
import { lazyElectronStore } from '../storage/lazy-electron-store';
import { logger } from '../logger';

interface PrivacyState extends Record<string, unknown> {
  network: NetworkPolicy;
}

const store = lazyElectronStore<PrivacyState>({
  name: 'privacy',
  defaults: { network: DEFAULT_NETWORK_POLICY },
});

export const FAIL_CLOSED_NETWORK_POLICY: NetworkPolicy = {
  localOnlyMode: true,
  allowlist: [],
};

export function readNetworkPolicyFromStore(): NetworkPolicy {
  let raw: unknown;
  try {
    raw = store.get('network');
  } catch (err) {
    logger.error({ err }, 'privacy store read failed — falling back to fail-closed policy');
    return { ...FAIL_CLOSED_NETWORK_POLICY };
  }
  const parsed = networkPolicySchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  logger.error(
    { issues: parsed.error.issues },
    'privacy store contained invalid network policy — falling back to fail-closed (Local Only, empty allowlist)',
  );
  return { ...FAIL_CLOSED_NETWORK_POLICY };
}

export function writeNetworkPolicyToStore(policy: NetworkPolicy): NetworkPolicy {
  const parsed = networkPolicySchema.parse(policy);
  store.set('network', parsed);
  return parsed;
}
