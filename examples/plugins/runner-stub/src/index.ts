import { definePlugin } from '@opencodex/plugin-sdk';
import { stubRunner } from './runner.js';

// A plugin's entry point exports a Plugin via `definePlugin`. The host calls
// `activate(host)` exactly once after loading the manifest; this is where you
// register runners, tools, providers, panels, or slash commands.

export default definePlugin({
  activate(host) {
    host.registerRunner(stubRunner);
    host.logger.info('runner-stub plugin activated');
  },
});
