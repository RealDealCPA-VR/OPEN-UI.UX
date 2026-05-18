import { z } from 'zod';
import { definePlugin } from '@opencodex/plugin-sdk';
import { defineTool } from '@opencodex/core';

const input = z.object({ name: z.string().optional() });

const helloWorldTool = defineTool({
  name: 'hello_world',
  description: 'Returns a friendly greeting — proves the plugin SDK works',
  inputZod: input,
  permissionTier: 'read',
  async execute({ name }) {
    return `Hello, ${name ?? 'world'}!`;
  },
});

export default definePlugin({
  activate(host) {
    host.registerTool(helloWorldTool);
    host.logger.info('hello-world plugin activated');
  },
});
