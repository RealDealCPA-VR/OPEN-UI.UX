import { BrowserWindow } from 'electron';
import { z } from 'zod';
import type { ApprovalRequest } from '../../shared/approvals';
import { registerInvoke } from '../ipc/registry';
import {
  getApprovalPolicies,
  getReadOnlyChatMode,
  getSettings,
  setApprovalPolicies,
} from '../storage/settings';
import { getApprovalManager, initApprovalManager } from './approvals';
import { readFilePreview } from './file-preview';

const tierEnum = z.enum(['read', 'write', 'execute', 'network']);
const policyEnum = z.enum(['auto', 'prompt', 'deny']);
const decisionEnum = z.enum(['allow', 'deny']);
const scopeEnum = z.enum(['once', 'session', 'always']);

export function registerApprovalHandlers(): void {
  initApprovalManager(
    broadcastApprovalRequest,
    getApprovalPolicies,
    setApprovalPolicies,
    getReadOnlyChatMode,
  );

  registerInvoke('approvals:get-policies', z.void(), () => getApprovalPolicies());

  registerInvoke(
    'approvals:set-policy',
    z.object({
      scope: z.enum(['tier', 'tool']),
      key: z.string().min(1),
      policy: policyEnum.nullable(),
    }),
    (req) => {
      const current = getApprovalPolicies();
      if (req.scope === 'tier') {
        const tier = tierEnum.parse(req.key);
        const policy = req.policy ?? 'prompt';
        return setApprovalPolicies({
          ...current,
          tierDefaults: { ...current.tierDefaults, [tier]: policy },
        });
      }
      const nextOverrides = { ...current.toolOverrides };
      if (req.policy === null) delete nextOverrides[req.key];
      else nextOverrides[req.key] = req.policy;
      return setApprovalPolicies({ ...current, toolOverrides: nextOverrides });
    },
  );

  registerInvoke(
    'approvals:respond',
    z.object({
      requestId: z.string().min(1),
      decision: decisionEnum,
      scope: scopeEnum,
    }),
    (req) => {
      getApprovalManager().respond(req);
    },
  );

  registerInvoke(
    'approvals:read-file-preview',
    z.object({ path: z.string().min(1) }),
    async (req) => {
      const workspaceRoot = getSettings().activeWorkspace ?? process.cwd();
      return readFilePreview(workspaceRoot, req.path);
    },
  );
}

function broadcastApprovalRequest(req: ApprovalRequest): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('chat:approval-request', req);
  }
}
