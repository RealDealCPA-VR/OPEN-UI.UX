import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { getOnboardingComplete, setOnboardingComplete } from '../storage/settings';

export function registerOnboardingHandlers(): void {
  registerInvoke('onboarding:get-state', z.void(), () => ({
    complete: getOnboardingComplete(),
  }));
  registerInvoke(
    'onboarding:set-complete',
    z.object({ complete: z.boolean() }),
    ({ complete }) => ({ complete: setOnboardingComplete(complete) }),
  );
}
