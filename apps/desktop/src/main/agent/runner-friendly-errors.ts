import type { RunnerFriendlyError, RunnerFriendlyErrorKind } from '../../shared/runner-discovery';

interface PatternEntry {
  pattern: RegExp;
  kind: RunnerFriendlyErrorKind;
  message: string;
}

const COMMON_PATTERNS: readonly PatternEntry[] = [
  { pattern: /not authenticated/i, kind: 'auth', message: 'Runner is not authenticated.' },
  { pattern: /missing api key/i, kind: 'auth', message: 'Runner is missing an API key.' },
  { pattern: /\b401\b/, kind: 'auth', message: 'Runner returned 401 Unauthorized.' },
  { pattern: /unauthori[sz]ed/i, kind: 'auth', message: 'Runner returned an unauthorized error.' },
  { pattern: /please .* login/i, kind: 'auth', message: 'Runner requires a login step.' },
  { pattern: /credential/i, kind: 'auth', message: 'Runner could not load valid credentials.' },
  {
    pattern: /no such model/i,
    kind: 'model-not-found',
    message: 'Selected model is not available to this runner.',
  },
  {
    pattern: /model not found/i,
    kind: 'model-not-found',
    message: 'Selected model is not available to this runner.',
  },
  { pattern: /rate.?limit/i, kind: 'rate-limit', message: 'Runner is being rate-limited.' },
  { pattern: /\b429\b/, kind: 'rate-limit', message: 'Runner returned 429 Too Many Requests.' },
  { pattern: /too many requests/i, kind: 'rate-limit', message: 'Runner is being rate-limited.' },
  {
    pattern: /ENOTFOUND/,
    kind: 'network',
    message: 'Network lookup failed — check your connection.',
  },
  { pattern: /ECONNREFUSED/, kind: 'network', message: 'Network connection was refused.' },
  { pattern: /network/i, kind: 'network', message: 'Runner hit a network error.' },
];

const PER_RUNNER_FIXES: Record<string, Partial<Record<RunnerFriendlyErrorKind, string>>> = {
  'claude-code': {
    auth: "Run 'claude login' in your terminal.",
    'model-not-found':
      'Check the model name with `claude --help` or pick a different model in OpenCodex.',
    'rate-limit': 'Wait a minute, then try again. Anthropic enforces per-minute limits.',
    network: 'Check your network connection and any proxy settings.',
  },
  opencode: {
    auth: "Run 'opencode auth login' or check ~/.config/opencode/.",
    'model-not-found': 'Run `opencode models` to list available models.',
    'rate-limit': 'Wait a minute, then try again.',
    network: 'Check your network connection.',
  },
  aider: {
    auth: 'Set OPENAI_API_KEY or ANTHROPIC_API_KEY in your environment.',
    'model-not-found': 'Pass `--model <id>` with a model your provider supports.',
    'rate-limit': 'Wait a minute, then try again.',
    network: 'Check your network connection.',
  },
};

function fixFor(runnerId: string, kind: RunnerFriendlyErrorKind): string | undefined {
  const perRunner = PER_RUNNER_FIXES[runnerId];
  if (perRunner && perRunner[kind]) return perRunner[kind];
  if (kind === 'auth') return 'Check the runner CLI is authenticated.';
  if (kind === 'network') return 'Check your network connection.';
  if (kind === 'rate-limit') return 'Wait, then try again.';
  return undefined;
}

export function classifyRunnerError(runnerId: string, errText: string): RunnerFriendlyError {
  const text = errText ?? '';
  for (const entry of COMMON_PATTERNS) {
    if (entry.pattern.test(text)) {
      const fix = fixFor(runnerId, entry.kind);
      const friendly: RunnerFriendlyError = {
        runnerId,
        kind: entry.kind,
        message: entry.message,
      };
      if (fix !== undefined) friendly.suggestedFix = fix;
      return friendly;
    }
  }
  const trimmed = text.trim().slice(0, 240);
  return {
    runnerId,
    kind: 'unknown',
    message: trimmed.length > 0 ? trimmed : 'Runner failed with no error message.',
  };
}
