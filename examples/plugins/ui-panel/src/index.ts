import { definePlugin } from '@opencodex/plugin-sdk';

export default definePlugin({
  activate(host) {
    host.logger.info('ui-panel example plugin activated');
  },
});
