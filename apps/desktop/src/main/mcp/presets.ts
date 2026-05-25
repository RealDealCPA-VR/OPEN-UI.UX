import type { McpServerEntry } from '../../shared/mcp';

export interface McpServerPreset {
  id: string;
  displayName: string;
  description: string;
  template: Omit<McpServerEntry, 'enabled'>;
}

export const MCP_PRESETS: readonly McpServerPreset[] = [
  {
    id: 'filesystem',
    displayName: 'Filesystem',
    description: 'Read, write, and search files in a directory you grant access to.',
    template: {
      id: 'filesystem',
      displayName: 'Filesystem',
      config: {
        kind: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '${workspaceRoot}'],
      },
    },
  },
  {
    id: 'github',
    displayName: 'GitHub',
    description: 'Search code, read issues + PRs, post comments. Requires GITHUB_TOKEN.',
    template: {
      id: 'github',
      displayName: 'GitHub',
      config: {
        kind: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: '${env:GITHUB_TOKEN}' },
      },
    },
  },
  {
    id: 'brave-search',
    displayName: 'Brave Search',
    description: 'Web search via Brave. Requires BRAVE_API_KEY.',
    template: {
      id: 'brave-search',
      displayName: 'Brave Search',
      config: {
        kind: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-brave-search'],
        env: { BRAVE_API_KEY: '${env:BRAVE_API_KEY}' },
      },
    },
  },
  {
    id: 'sqlite',
    displayName: 'SQLite',
    description: 'Query a local SQLite database.',
    template: {
      id: 'sqlite',
      displayName: 'SQLite',
      config: {
        kind: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sqlite', '${dbPath}'],
      },
    },
  },
];
