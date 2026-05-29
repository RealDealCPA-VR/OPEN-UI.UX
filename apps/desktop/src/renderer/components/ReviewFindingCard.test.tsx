import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReviewFindingCard } from './ReviewFindingCard';
import type { ReviewFinding } from '../../shared/review';

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: 'f1',
    filePath: 'src/foo.ts',
    startLine: 10,
    endLine: 12,
    severity: 'bug',
    title: 'Missing await',
    rationale: 'The async call is not awaited; result is a Promise.',
    suggestedFix: 'await foo()',
    retrievedContext: [],
    prompt: 'Add await to foo()',
    auditPrompt: null,
    auditRetrievedContext: [],
    ...overrides,
  };
}

describe('ReviewFindingCard', () => {
  it('renders severity, file path, and rationale', () => {
    render(
      <ReviewFindingCard finding={makeFinding()} selected={false} onToggleSelected={vi.fn()} />,
    );
    expect(screen.getByText(/Missing await/)).toBeTruthy();
    expect(screen.getByText(/src\/foo\.ts:L10-L12/)).toBeTruthy();
    expect(screen.getByText(/bug/i)).toBeTruthy();
  });

  it('omits the audit disclosure when no audit data is present', () => {
    render(
      <ReviewFindingCard finding={makeFinding()} selected={false} onToggleSelected={vi.fn()} />,
    );
    expect(screen.queryByText(/Show prompt/i)).toBeNull();
  });

  it('reveals the LLM prompt + retrieved context in the audit disclosure', () => {
    const finding = makeFinding({
      auditPrompt: 'SYSTEM:\nYou are a senior code reviewer.\n\nUSER:\nPlease review...',
      auditRetrievedContext: ['Focus on the auth boundary.'],
    });
    render(<ReviewFindingCard finding={finding} selected={true} onToggleSelected={vi.fn()} />);
    const summary = screen.getByText(/Show prompt/i);
    fireEvent.click(summary);
    // <details> opens — the prompt should now be readable in the DOM.
    expect(screen.getByLabelText('Audit prompt').textContent).toContain('senior code reviewer');
    expect(screen.getByText('Focus on the auth boundary.')).toBeTruthy();
  });

  it('fires copy callback only when both prompt and handler exist', () => {
    const onCopyPrompt = vi.fn();
    render(
      <ReviewFindingCard
        finding={makeFinding()}
        selected={false}
        onToggleSelected={vi.fn()}
        onCopyPrompt={onCopyPrompt}
      />,
    );
    fireEvent.click(screen.getByText(/Copy fix prompt/));
    expect(onCopyPrompt).toHaveBeenCalledTimes(1);
  });
});
