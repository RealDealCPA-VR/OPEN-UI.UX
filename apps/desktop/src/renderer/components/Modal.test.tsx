import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const onClose = vi.fn();
    render(
      <Modal open={false} onClose={onClose}>
        <button>inside</button>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a role=dialog with aria-modal=true', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <h2 id="t">Title</h2>
        <button>action</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('focuses the first focusable element on open', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <button>first</button>
        <button>second</button>
      </Modal>,
    );
    expect(document.activeElement?.textContent).toBe('first');
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <button>x</button>
      </Modal>,
    );
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cycles focus on Tab from last to first', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <button>first</button>
        <button>last</button>
      </Modal>,
    );
    const [first, last] = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role=dialog] button'),
    );
    last?.focus();
    expect(document.activeElement).toBe(last);
    act(() => {
      fireEvent.keyDown(document, { key: 'Tab' });
    });
    expect(document.activeElement).toBe(first);
  });

  it('cycles focus on Shift+Tab from first to last', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <button>first</button>
        <button>last</button>
      </Modal>,
    );
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role=dialog] button'),
    );
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    first?.focus();
    act(() => {
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    });
    expect(document.activeElement).toBe(last);
  });
});
