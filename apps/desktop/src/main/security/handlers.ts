import { BrowserWindow } from 'electron';
import { z } from 'zod';
import {
  addAllowlistEntryRequestSchema,
  removeAllowlistEntryRequestSchema,
  setLocalOnlyModeRequestSchema,
  type NetworkPolicy,
} from '../../shared/network-policy';
import { registerInvoke } from '../ipc/registry';
import {
  addAllowlistEntry,
  removeAllowlistEntry,
  setNetworkPolicyCache,
  snapshotNetworkPolicy,
} from './network-policy';
import { readNetworkPolicyFromStore, writeNetworkPolicyToStore } from './store';

function broadcast(policy: NetworkPolicy): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('network:policy-changed', { policy });
    }
  }
}

function persist(policy: NetworkPolicy): NetworkPolicy {
  const saved = writeNetworkPolicyToStore(policy);
  setNetworkPolicyCache(saved);
  broadcast(saved);
  return saved;
}

export function initNetworkPolicy(): void {
  const initial = readNetworkPolicyFromStore();
  setNetworkPolicyCache(initial);
}

export function registerNetworkPolicyHandlers(): void {
  initNetworkPolicy();

  registerInvoke('network:get-policy', z.void(), () => snapshotNetworkPolicy());

  registerInvoke('network:set-local-only', setLocalOnlyModeRequestSchema, (req) => {
    const current = snapshotNetworkPolicy();
    return persist({ ...current, localOnlyMode: req.enabled });
  });

  registerInvoke('network:add-allowlist-entry', addAllowlistEntryRequestSchema, (req) => {
    const current = snapshotNetworkPolicy();
    const next = addAllowlistEntry(current.allowlist, req.hostname);
    return persist({ ...current, allowlist: next });
  });

  registerInvoke('network:remove-allowlist-entry', removeAllowlistEntryRequestSchema, (req) => {
    const current = snapshotNetworkPolicy();
    const next = removeAllowlistEntry(current.allowlist, req.hostname);
    return persist({ ...current, allowlist: next });
  });
}
