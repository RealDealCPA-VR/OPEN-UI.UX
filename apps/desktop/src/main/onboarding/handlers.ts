import { homedir } from 'node:os';
import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import {
  clearOnboardingSteps,
  getOnboardingComplete,
  getOnboardingStep,
  getOnboardingSteps,
  setOnboardingComplete,
  setOnboardingStep,
} from '../storage/settings';

export function registerOnboardingHandlers(): void {
  registerInvoke('onboarding:get-state', z.void(), () => ({
    complete: getOnboardingComplete(),
    steps: getOnboardingSteps(),
  }));
  registerInvoke(
    'onboarding:set-complete',
    z.object({ complete: z.boolean() }),
    ({ complete }) => ({ complete: setOnboardingComplete(complete) }),
  );
  registerInvoke(
    'onboarding:get-step',
    z.object({ stepName: z.string().min(1) }),
    ({ stepName }) => ({ value: getOnboardingStep(stepName) }),
  );
  registerInvoke(
    'onboarding:set-step',
    z.object({ stepName: z.string().min(1), value: z.unknown() }),
    ({ stepName, value }) => ({ steps: setOnboardingStep(stepName, value) }),
  );
  registerInvoke('onboarding:clear-steps', z.void(), () => ({
    steps: clearOnboardingSteps(),
  }));
  // Renderer can't import node:os, so we hand it the home dir for the
  // zero-friction first-run pre-seeded workspace.
  registerInvoke('onboarding:get-defaults', z.void(), () => ({ homedir: homedir() }));
}
