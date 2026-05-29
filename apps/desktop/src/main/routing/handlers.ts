import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import {
  createRoutingPolicyRequestSchema,
  deleteRoutingPolicyRequestSchema,
  setActiveRoutingPolicyRequestSchema,
  updateRoutingPolicyRequestSchema,
} from '../../shared/routing';
import {
  createRoutingPolicy,
  deleteRoutingPolicy,
  getRoutingState,
  onRoutingChanged,
  setActiveRoutingPolicy,
  updateRoutingPolicy,
} from './routing-store';

export function registerRoutingHandlers(): void {
  registerInvoke('routing:get-state', z.void(), () => getRoutingState());
  registerInvoke('routing:create-policy', createRoutingPolicyRequestSchema, (req) =>
    createRoutingPolicy(req.policy),
  );
  registerInvoke('routing:update-policy', updateRoutingPolicyRequestSchema, (req) =>
    updateRoutingPolicy(req.id, req.patch),
  );
  registerInvoke('routing:delete-policy', deleteRoutingPolicyRequestSchema, (req) =>
    deleteRoutingPolicy(req.id),
  );
  registerInvoke('routing:set-active', setActiveRoutingPolicyRequestSchema, (req) =>
    setActiveRoutingPolicy(req.id),
  );

  onRoutingChanged((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('routing:changed', { state });
    }
  });
}
