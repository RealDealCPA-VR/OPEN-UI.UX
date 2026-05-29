import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { getSettings, updateSettings } from '../storage/settings';
import { antiSycophancySetRequestSchema } from '../../shared/anti-sycophancy';

export function getAntiSycophancyEnabled(): boolean {
  const value = getSettings().antiSycophancyEnabled;
  return value !== false;
}

export function setAntiSycophancyEnabled(enabled: boolean): boolean {
  const next = updateSettings({ antiSycophancyEnabled: enabled });
  return next.antiSycophancyEnabled !== false;
}

export function registerAntiSycophancyHandlers(): void {
  registerInvoke('anti-sycophancy:get', z.void(), () => getAntiSycophancyEnabled());
  registerInvoke('anti-sycophancy:set', antiSycophancySetRequestSchema, (req) =>
    setAntiSycophancyEnabled(req.enabled),
  );
}
