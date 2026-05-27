import type { PluginHost } from '@opencodex/plugin-sdk';
import { createAiderRunner } from './runner';

export { createAiderRunner } from './runner';
export { checkInstalled, autoDetect, AIDER_INSTALL_HINT } from './check-installed';
export { LineBuffer } from './line-buffer';

export function activate(host: PluginHost): void {
  host.registerRunner(createAiderRunner(host));
  host.logger.info('runner-aider activated');
}

export default { activate };
