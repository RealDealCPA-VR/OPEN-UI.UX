import type { PluginHost } from '@opencodex/plugin-sdk';
import { createClaudeCodeRunner } from './runner';

export { createClaudeCodeRunner } from './runner';
export { checkInstalled, autoDetect, CLAUDE_INSTALL_HINT } from './check-installed';
export { translateClaudeJson, NdjsonBuffer, createTranslatorState } from './event-translator';

export function activate(host: PluginHost): void {
  host.registerRunner(createClaudeCodeRunner(host));
  host.logger.info('runner-claude-code activated');
}

export default { activate };
