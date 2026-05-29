import Store from 'electron-store';
import {
  DEFAULT_NETWORK_POLICY,
  networkPolicySchema,
  type NetworkPolicy,
} from '../../shared/network-policy';

interface PrivacyState {
  network: NetworkPolicy;
}

const store = new Store<PrivacyState>({
  name: 'privacy',
  defaults: { network: DEFAULT_NETWORK_POLICY },
});

export function readNetworkPolicyFromStore(): NetworkPolicy {
  const raw = store.get('network');
  const parsed = networkPolicySchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return { ...DEFAULT_NETWORK_POLICY, allowlist: [...DEFAULT_NETWORK_POLICY.allowlist] };
}

export function writeNetworkPolicyToStore(policy: NetworkPolicy): NetworkPolicy {
  const parsed = networkPolicySchema.parse(policy);
  store.set('network', parsed);
  return parsed;
}
