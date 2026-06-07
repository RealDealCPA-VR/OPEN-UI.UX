// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginSlashCommandDescriptor } from '../../shared/plugins';
import { SlashCommands } from './SlashCommands';

afterEach(() => {
  cleanup();
});

const command: PluginSlashCommandDescriptor = {
  pluginId: 'p1',
  pluginName: 'Deploy Tools',
  name: 'deploy',
  description: 'ship to prod',
};

function renderMenu(
  query: string,
  onSelectPlugin = vi.fn(),
): { onSelectPlugin: typeof onSelectPlugin } {
  render(
    <SlashCommands
      query={query}
      prompts={[]}
      skills={[]}
      pluginCommands={[command]}
      activeIndex={0}
      onSelectMcp={vi.fn()}
      onSelectSkill={vi.fn()}
      onSelectPlugin={onSelectPlugin}
      onActiveIndexChange={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return { onSelectPlugin };
}

describe('SlashCommands plugin commands', () => {
  it('renders a Plugin group with the command name', () => {
    renderMenu('');
    expect(screen.getByText('Plugin — Deploy Tools')).toBeTruthy();
    expect(screen.getByText('deploy')).toBeTruthy();
  });

  it('invokes onSelectPlugin when the command is chosen', () => {
    const { onSelectPlugin } = renderMenu('');
    fireEvent.mouseDown(screen.getByText('deploy'));
    expect(onSelectPlugin).toHaveBeenCalledWith(command);
  });

  it('hides the command when the query does not match', () => {
    renderMenu('zzz');
    expect(screen.queryByText('deploy')).toBeNull();
  });
});
