import type { PluginHost } from '@opencodex/plugin-sdk';
import { createOpenCodeRunner } from './runner';

export { createOpenCodeRunner } from './runner';
export { checkInstalled, autoDetect, OPENCODE_INSTALL_HINT } from './check-installed';
export { translateOpenCodeJson, NdjsonBuffer, createTranslatorState } from './event-translator';

export function activate(host: PluginHost): void {
  host.registerRunner(createOpenCodeRunner(host));
  host.logger.info('runner-opencode activated');
}

export default { activate };
