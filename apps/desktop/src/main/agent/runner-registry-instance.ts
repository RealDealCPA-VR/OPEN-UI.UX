import { RunnerRegistry } from '@opencodex/core';

export const runnerRegistry = new RunnerRegistry();

const PLUGIN_PREFIX = 'plugin__';

// The UI and tools refer to runners by their exposed id (e.g. `claude-code`),
// but plugin-contributed runners register under a wrapped id
// (`plugin__<pluginId>__<bareId>`). Resolve the exposed id to the actual
// registered id so callers can look the runner up. Returns null if no runner
// matches.
export function resolveRegisteredRunnerId(requestedId: string): string | null {
  if (runnerRegistry.has(requestedId)) return requestedId;
  const wrapped = runnerRegistry
    .list()
    .find((r) => r.id.startsWith(PLUGIN_PREFIX) && r.id.endsWith(`__${requestedId}`));
  return wrapped ? wrapped.id : null;
}
