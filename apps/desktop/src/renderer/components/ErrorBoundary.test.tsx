import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): JSX.Element {
  throw new Error('kaboom');
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <span>ok</span>
      </ErrorBoundary>,
    );
    expect(screen.getByText('ok')).toBeTruthy();
  });

  it('renders a fallback when child throws', () => {
    render(
      <ErrorBoundary label="Inner">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toContain('kaboom');
    expect(screen.getByRole('alert').textContent).toContain('Inner');
  });

  it('invokes a custom fallback render prop with reset', () => {
    function Test(): JSX.Element {
      const [boom, setBoom] = useState(true);
      return (
        <ErrorBoundary
          fallback={(err, reset) => (
            <div>
              <span>fallback: {err.message}</span>
              <button
                onClick={() => {
                  setBoom(false);
                  reset();
                }}
              >
                retry
              </button>
            </div>
          )}
        >
          {boom ? <Boom /> : <span>recovered</span>}
        </ErrorBoundary>
      );
    }
    render(<Test />);
    expect(screen.getByText(/fallback: kaboom/)).toBeTruthy();
    fireEvent.click(screen.getByText('retry'));
    expect(screen.getByText('recovered')).toBeTruthy();
  });
});
