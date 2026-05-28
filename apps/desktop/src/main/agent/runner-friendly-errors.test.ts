import { describe, expect, it } from 'vitest';
import { classifyRunnerError } from './runner-friendly-errors';

describe('classifyRunnerError — kind detection', () => {
  it.each([
    ['claude-code', 'Error: not authenticated', 'auth'],
    ['opencode', 'missing api key for provider', 'auth'],
    ['aider', 'HTTP 401 returned by server', 'auth'],
    ['claude-code', 'unauthorized: token expired', 'auth'],
    ['opencode', 'please run login first', 'auth'],
    ['aider', 'credential helper failed', 'auth'],
    ['claude-code', 'Error: no such model claude-opus-99', 'model-not-found'],
    ['opencode', 'model not found in registry', 'model-not-found'],
    ['claude-code', 'rate limit exceeded', 'rate-limit'],
    ['opencode', 'HTTP 429 Too Many Requests', 'rate-limit'],
    ['aider', 'too many requests, retry later', 'rate-limit'],
    ['claude-code', 'getaddrinfo ENOTFOUND api.anthropic.com', 'network'],
    ['opencode', 'connect ECONNREFUSED 127.0.0.1:11434', 'network'],
    ['aider', 'network unreachable', 'network'],
  ])('runner=%s stderr=%s → kind=%s', (runnerId, stderr, expectedKind) => {
    const result = classifyRunnerError(runnerId, stderr);
    expect(result.kind).toBe(expectedKind);
    expect(result.runnerId).toBe(runnerId);
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe('classifyRunnerError — per-runner suggestedFix', () => {
  it("claude-code auth suggests 'claude login'", () => {
    const r = classifyRunnerError('claude-code', 'not authenticated');
    expect(r.kind).toBe('auth');
    expect(r.suggestedFix).toMatch(/claude login/);
  });

  it("opencode auth points at 'opencode auth login' or ~/.config/opencode", () => {
    const r = classifyRunnerError('opencode', 'not authenticated');
    expect(r.kind).toBe('auth');
    expect(r.suggestedFix).toMatch(/opencode auth login|opencode/);
  });

  it('aider auth points at OPENAI_API_KEY / ANTHROPIC_API_KEY env vars', () => {
    const r = classifyRunnerError('aider', 'missing api key');
    expect(r.kind).toBe('auth');
    expect(r.suggestedFix).toMatch(/OPENAI_API_KEY|ANTHROPIC_API_KEY/);
  });

  it.each([
    ['claude-code', /claude|model/i, 'no such model x'],
    ['opencode', /opencode models/i, 'model not found'],
    ['aider', /--model/i, 'no such model y'],
  ] as const)(
    '%s model-not-found suggestedFix matches expected hint',
    (runnerId, expectedHint, stderr) => {
      const r = classifyRunnerError(runnerId, stderr);
      expect(r.kind).toBe('model-not-found');
      expect(r.suggestedFix).toMatch(expectedHint);
    },
  );

  it.each(['claude-code', 'opencode', 'aider'])(
    '%s rate-limit suggestedFix mentions waiting',
    (runnerId) => {
      const r = classifyRunnerError(runnerId, 'rate limit exceeded');
      expect(r.kind).toBe('rate-limit');
      expect(r.suggestedFix).toMatch(/wait/i);
    },
  );

  it.each(['claude-code', 'opencode', 'aider'])(
    '%s network suggestedFix mentions network connection',
    (runnerId) => {
      const r = classifyRunnerError(runnerId, 'ENOTFOUND example.com');
      expect(r.kind).toBe('network');
      expect(r.suggestedFix).toMatch(/network|connection/i);
    },
  );
});

describe('classifyRunnerError — unknown', () => {
  it('returns kind=unknown when no pattern matches', () => {
    const r = classifyRunnerError('claude-code', 'something totally unexpected: zorp-7');
    expect(r.kind).toBe('unknown');
    expect(r.suggestedFix).toBeUndefined();
    expect(r.message).toContain('zorp-7');
  });

  it('returns a placeholder message when stderr is empty', () => {
    const r = classifyRunnerError('claude-code', '');
    expect(r.kind).toBe('unknown');
    expect(r.message.length).toBeGreaterThan(0);
  });

  it('falls back gracefully when given a runnerId without per-runner fixes', () => {
    const r = classifyRunnerError('plugin-runner-xyz', 'not authenticated');
    expect(r.kind).toBe('auth');
    expect(r.suggestedFix).toMatch(/authenticated/i);
  });
});
