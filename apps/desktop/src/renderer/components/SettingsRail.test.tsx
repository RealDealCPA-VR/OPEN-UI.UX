import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsRail } from './SettingsRail';
import type { SettingsSection } from '../views/settings-sections';

const sections: readonly SettingsSection[] = [
  { slug: 'general', title: 'General', description: 'General settings' },
  { slug: 'editor', title: 'Editor', description: 'Editor settings' },
];

function renderRail(query = ''): { onQueryChange: ReturnType<typeof vi.fn> } {
  const onQueryChange = vi.fn();
  const onSelect = vi.fn();
  render(
    <div className="settings-view">
      <SettingsRail
        sections={sections}
        activeSlug="general"
        onSelect={onSelect}
        query={query}
        onQueryChange={onQueryChange}
      />
      <textarea className="monaco-editor-host" aria-label="code" />
    </div>,
  );
  return { onQueryChange };
}

describe('SettingsRail Cmd/Ctrl+F scoping', () => {
  it('focuses the search input on Ctrl+F from a neutral target', () => {
    renderRail();
    const input = screen.getByLabelText('Search settings');
    const list = screen.getByRole('list');
    act(() => {
      fireEvent.keyDown(list, { key: 'f', ctrlKey: true });
    });
    expect(document.activeElement).toBe(input);
  });

  it('ignores Ctrl+F when the event target is a textarea', () => {
    renderRail();
    const input = screen.getByLabelText('Search settings');
    const textarea = screen.getByLabelText('code');
    textarea.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      textarea.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(input);
  });

  it('ignores Ctrl+F when focus is inside a Monaco editor', () => {
    render(
      <div className="settings-view">
        <SettingsRail
          sections={sections}
          activeSlug="general"
          onSelect={vi.fn()}
          query=""
          onQueryChange={vi.fn()}
        />
        <div className="monaco-editor">
          <textarea aria-label="monaco-input" />
        </div>
      </div>,
    );
    const input = screen.getByLabelText('Search settings');
    const monaco = screen.getByLabelText('monaco-input');
    monaco.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      monaco.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(input);
  });
});
