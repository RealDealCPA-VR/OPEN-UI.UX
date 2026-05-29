import Store from 'electron-store';
import {
  routingPolicySchema,
  routingStateSchema,
  type RoutingPolicy,
  type RoutingState,
} from '../../shared/routing';

interface RoutingStoreShape {
  routingPolicies: RoutingPolicy[];
  activeRoutingPolicyId: string | null;
}

const defaults: RoutingStoreShape = {
  routingPolicies: [],
  activeRoutingPolicyId: null,
};

const store = new Store<RoutingStoreShape>({
  name: 'routing',
  defaults,
});

type Listener = (state: RoutingState) => void;
const listeners = new Set<Listener>();

function emit(): void {
  if (listeners.size === 0) return;
  const snapshot = getRoutingState();
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch {
      // never let a listener take down the store
    }
  }
}

export function onRoutingChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getRoutingState(): RoutingState {
  const raw = store.store;
  const policies: RoutingPolicy[] = [];
  for (const candidate of raw.routingPolicies ?? []) {
    const parsed = routingPolicySchema.safeParse(candidate);
    if (parsed.success) policies.push(parsed.data);
  }
  const idSet = new Set(policies.map((p) => p.id));
  const activeId = raw.activeRoutingPolicyId;
  const activePolicyId = activeId && idSet.has(activeId) ? activeId : null;
  return routingStateSchema.parse({ policies, activePolicyId });
}

export function getActiveRoutingPolicy(): RoutingPolicy | null {
  const { policies, activePolicyId } = getRoutingState();
  if (!activePolicyId) return null;
  return policies.find((p) => p.id === activePolicyId) ?? null;
}

export function createRoutingPolicy(policy: RoutingPolicy): RoutingState {
  const parsed = routingPolicySchema.parse(policy);
  const state = getRoutingState();
  if (state.policies.some((p) => p.id === parsed.id)) {
    throw new Error(`Routing policy "${parsed.id}" already exists`);
  }
  store.set('routingPolicies', [...state.policies, parsed]);
  emit();
  return getRoutingState();
}

export function updateRoutingPolicy(id: string, patch: Partial<RoutingPolicy>): RoutingState {
  const state = getRoutingState();
  const next = state.policies.map((p) =>
    p.id === id ? routingPolicySchema.parse({ ...p, ...patch, id: p.id }) : p,
  );
  if (next.every((p) => p.id !== id)) {
    throw new Error(`Routing policy "${id}" not found`);
  }
  store.set('routingPolicies', next);
  emit();
  return getRoutingState();
}

export function deleteRoutingPolicy(id: string): RoutingState {
  const state = getRoutingState();
  store.set(
    'routingPolicies',
    state.policies.filter((p) => p.id !== id),
  );
  if (state.activePolicyId === id) store.set('activeRoutingPolicyId', null);
  emit();
  return getRoutingState();
}

export function setActiveRoutingPolicy(id: string | null): RoutingState {
  if (id !== null) {
    const state = getRoutingState();
    if (!state.policies.some((p) => p.id === id)) {
      throw new Error(`Routing policy "${id}" not found`);
    }
  }
  store.set('activeRoutingPolicyId', id);
  emit();
  return getRoutingState();
}
