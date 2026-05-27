export interface PluginPreset {
  id: string;
  displayName: string;
  description: string;
  source: string;
  installHint?: string;
}

export const PLUGIN_PRESETS: readonly PluginPreset[] = [
  {
    id: 'runner-claude-code',
    displayName: 'Claude Code Runner',
    description: 'Run subagents via the Claude Code CLI. Requires the claude CLI installed.',
    source: 'packages/runner-claude-code',
    installHint: 'Install Claude Code from https://docs.claude.com/en/docs/claude-code',
  },
  {
    id: 'runner-opencode',
    displayName: 'OpenCode Runner',
    description: 'Run subagents via the OpenCode CLI in headless mode.',
    source: 'packages/runner-opencode',
    installHint: 'Install OpenCode from https://github.com/opencode-ai/opencode',
  },
  {
    id: 'runner-aider',
    displayName: 'Aider Runner',
    description: 'Run subagents via the Aider CLI. Spinner-style progress (non-streaming).',
    source: 'packages/runner-aider',
    installHint: 'Install Aider from https://aider.chat/docs/install.html',
  },
];
