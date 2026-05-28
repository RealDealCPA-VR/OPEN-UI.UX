// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mountCounts = {
  chat: 0,
  agent: 0,
  codebase: 0,
  automations: 0,
};

function resetCounts(): void {
  mountCounts.chat = 0;
  mountCounts.agent = 0;
  mountCounts.codebase = 0;
  mountCounts.automations = 0;
}

vi.mock('./left-column-panes/ChatContextPane', () => ({
  default: () => {
    mountCounts.chat += 1;
    return <div data-testid="pane-chat">chat-pane</div>;
  },
}));

vi.mock('./left-column-panes/AgentContextPane', () => ({
  default: () => {
    mountCounts.agent += 1;
    return <div data-testid="pane-agent">agent-pane</div>;
  },
}));

vi.mock('./left-column-panes/CodebaseContextPane', () => ({
  default: () => {
    mountCounts.codebase += 1;
    return <div data-testid="pane-codebase">codebase-pane</div>;
  },
}));

vi.mock('./left-column-panes/AutomationsContextPane', () => ({
  default: () => {
    mountCounts.automations += 1;
    return <div data-testid="pane-automations">automations-pane</div>;
  },
}));

import { LeftColumnContextPane, routeFromPathname } from './LeftColumnContextPane';

describe('LeftColumnContextPane route dispatch', () => {
  beforeEach(() => {
    resetCounts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts only ChatContextPane on /chat', async () => {
    render(<LeftColumnContextPane route="chat" />);
    await waitFor(() => expect(screen.getByTestId('pane-chat')).toBeTruthy());
    expect(mountCounts.chat).toBe(1);
    expect(mountCounts.agent).toBe(0);
    expect(mountCounts.codebase).toBe(0);
    expect(mountCounts.automations).toBe(0);
  });

  it('mounts only AgentContextPane on /agent', async () => {
    render(<LeftColumnContextPane route="agent" />);
    await waitFor(() => expect(screen.getByTestId('pane-agent')).toBeTruthy());
    expect(mountCounts.agent).toBe(1);
    expect(mountCounts.chat).toBe(0);
    expect(mountCounts.codebase).toBe(0);
    expect(mountCounts.automations).toBe(0);
  });

  it('mounts only CodebaseContextPane on /codebase', async () => {
    render(<LeftColumnContextPane route="codebase" />);
    await waitFor(() => expect(screen.getByTestId('pane-codebase')).toBeTruthy());
    expect(mountCounts.codebase).toBe(1);
    expect(mountCounts.chat).toBe(0);
    expect(mountCounts.agent).toBe(0);
    expect(mountCounts.automations).toBe(0);
  });

  it('mounts only AutomationsContextPane on /automations', async () => {
    render(<LeftColumnContextPane route="automations" />);
    await waitFor(() => expect(screen.getByTestId('pane-automations')).toBeTruthy());
    expect(mountCounts.automations).toBe(1);
    expect(mountCounts.chat).toBe(0);
    expect(mountCounts.agent).toBe(0);
    expect(mountCounts.codebase).toBe(0);
  });

  it('renders nothing on /settings (SettingsView owns its own rail)', () => {
    const { container } = render(<LeftColumnContextPane route="settings" />);
    expect(container.textContent).toBe('');
    expect(mountCounts.chat).toBe(0);
    expect(mountCounts.agent).toBe(0);
    expect(mountCounts.codebase).toBe(0);
    expect(mountCounts.automations).toBe(0);
  });

  it('renders nothing on /runners (RunnersView owns its own header)', () => {
    const { container } = render(<LeftColumnContextPane route="runners" />);
    expect(container.textContent).toBe('');
    expect(mountCounts.chat).toBe(0);
    expect(mountCounts.agent).toBe(0);
    expect(mountCounts.codebase).toBe(0);
    expect(mountCounts.automations).toBe(0);
  });
});

describe('routeFromPathname', () => {
  it('maps /agent paths to agent', () => {
    expect(routeFromPathname('/agent')).toBe('agent');
    expect(routeFromPathname('/agent/run-1')).toBe('agent');
  });

  it('maps /codebase paths to codebase', () => {
    expect(routeFromPathname('/codebase')).toBe('codebase');
  });

  it('maps /automations paths to automations', () => {
    expect(routeFromPathname('/automations')).toBe('automations');
  });

  it('maps /settings paths to settings', () => {
    expect(routeFromPathname('/settings/theme')).toBe('settings');
  });

  it('maps /runners paths to runners', () => {
    expect(routeFromPathname('/runners')).toBe('runners');
    expect(routeFromPathname('/runners?install=claude-code')).toBe('runners');
  });

  it('defaults unknown paths to chat', () => {
    expect(routeFromPathname('/chat')).toBe('chat');
    expect(routeFromPathname('/unknown')).toBe('chat');
    expect(routeFromPathname('/')).toBe('chat');
  });
});
