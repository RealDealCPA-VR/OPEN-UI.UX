import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { FanoutConsentDecision, FanoutPlanTask } from '../../shared/agent-tree';
import type { RequestFanoutConsentOptions } from './fanout-consent';
import { createFanoutGate, type FanoutGateDeps } from './fanout-gate';

interface ConsentAnswer {
  decision: FanoutConsentDecision;
  editedPlan?: FanoutPlanTask[];
}

type ConsentMock = Mock<[RequestFanoutConsentOptions], Promise<ConsentAnswer>>;

function makeDeps(overrides: Partial<FanoutGateDeps> = {}): {
  deps: FanoutGateDeps;
  requestConsent: ConsentMock;
} {
  const requestConsent: ConsentMock = vi.fn<[RequestFanoutConsentOptions], Promise<ConsentAnswer>>(
    async () => ({ decision: 'allow' as const }),
  );
  const deps: FanoutGateDeps = {
    isAutoApproved: vi.fn(async () => false),
    hasConsentListeners: vi.fn(() => true),
    requestConsent,
    ...overrides,
  };
  return { deps, requestConsent };
}

const task: FanoutPlanTask = { task: 'audit the parser', runnerId: 'internal', modelId: 'gpt-4o' };

describe('createFanoutGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prompts on the first spawn of a run with the spawn plan', async () => {
    const { deps, requestConsent } = makeDeps();
    const gate = createFanoutGate(deps);

    const outcome = await gate.ensureConsent({}, task);

    expect(outcome.allowed).toBe(true);
    expect(requestConsent).toHaveBeenCalledTimes(1);
    const arg = requestConsent.mock.calls[0]?.[0] as {
      parentRunId: string;
      plan: FanoutPlanTask[];
    };
    expect(arg.plan).toEqual([task]);
    expect(arg.parentRunId).toMatch(/^fanout-/);
  });

  it('does not re-prompt for subsequent spawns in the same approved run', async () => {
    const { deps, requestConsent } = makeDeps();
    const gate = createFanoutGate(deps);
    const runKey = {};

    await gate.ensureConsent(runKey, task);
    const second = await gate.ensureConsent(runKey, { task: 'second task' });

    expect(second.allowed).toBe(true);
    expect(requestConsent).toHaveBeenCalledTimes(1);
  });

  it('prompts independently for distinct runs', async () => {
    const { deps, requestConsent } = makeDeps();
    const gate = createFanoutGate(deps);

    await gate.ensureConsent({}, task);
    await gate.ensureConsent({}, task);

    expect(requestConsent).toHaveBeenCalledTimes(2);
  });

  it('shares a single pending prompt across concurrent spawns in the same run', async () => {
    let resolveConsent: (answer: ConsentAnswer) => void = () => {};
    const requestConsent: ConsentMock = vi.fn<
      [RequestFanoutConsentOptions],
      Promise<ConsentAnswer>
    >(
      () =>
        new Promise<ConsentAnswer>((resolve) => {
          resolveConsent = resolve;
        }),
    );
    const { deps } = makeDeps({ requestConsent });
    const gate = createFanoutGate(deps);
    const runKey = {};

    const first = gate.ensureConsent(runKey, task);
    const second = gate.ensureConsent(runKey, { task: 'parallel sibling' });
    // The prompt sits behind the awaited auto-approve check — flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestConsent).toHaveBeenCalledTimes(1);

    resolveConsent({ decision: 'allow' });
    await expect(first).resolves.toMatchObject({ allowed: true });
    await expect(second).resolves.toMatchObject({ allowed: true });
  });

  it('denial yields allowed=false with a reason, and the next spawn re-prompts', async () => {
    const { deps, requestConsent } = makeDeps();
    requestConsent.mockResolvedValueOnce({ decision: 'deny' });
    const gate = createFanoutGate(deps);
    const runKey = {};

    const denied = await gate.ensureConsent(runKey, task);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('denied');

    const retried = await gate.ensureConsent(runKey, task);
    expect(retried.allowed).toBe(true);
    expect(requestConsent).toHaveBeenCalledTimes(2);
  });

  it('edit decision allows and carries the edited task text', async () => {
    const { deps, requestConsent } = makeDeps();
    requestConsent.mockResolvedValueOnce({
      decision: 'edit',
      editedPlan: [{ task: 'audit only the lexer' }],
    });
    const gate = createFanoutGate(deps);

    const outcome = await gate.ensureConsent({}, task);

    expect(outcome.allowed).toBe(true);
    expect(outcome.editedTask).toBe('audit only the lexer');
  });

  it('skips the prompt entirely when policy auto-approves', async () => {
    const { deps, requestConsent } = makeDeps({ isAutoApproved: vi.fn(async () => true) });
    const gate = createFanoutGate(deps);

    const outcome = await gate.ensureConsent({}, task);

    expect(outcome.allowed).toBe(true);
    expect(requestConsent).not.toHaveBeenCalled();
  });

  it('falls back to allow when no consent listener is attached (headless)', async () => {
    const { deps, requestConsent } = makeDeps({ hasConsentListeners: vi.fn(() => false) });
    const gate = createFanoutGate(deps);

    const outcome = await gate.ensureConsent({}, task);

    expect(outcome.allowed).toBe(true);
    expect(requestConsent).not.toHaveBeenCalled();
  });
});
