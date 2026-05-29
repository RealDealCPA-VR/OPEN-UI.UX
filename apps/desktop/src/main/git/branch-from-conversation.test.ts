import { describe, expect, it, vi } from 'vitest';
import {
  branchFromConversation,
  buildBranchName,
  scrubGitErrorMessage,
} from './branch-from-conversation';

vi.mock('../agent/worktrees', () => ({
  isGitRepo: vi.fn(async () => true),
}));

describe('buildBranchName', () => {
  it('prefixes with oc/ and slugifies', () => {
    expect(buildBranchName('My Cool Conversation')).toBe('oc/my-cool-conversation');
  });

  it('returns oc/untitled for blank titles', () => {
    expect(buildBranchName('   ')).toBe('oc/untitled');
  });
});

describe('branchFromConversation', () => {
  it('returns error when conversation missing', async () => {
    const result = await branchFromConversation(
      { conversationId: 'missing' },
      {
        lookupConversation: () => undefined,
        resolveRepoRoot: () => '/repo',
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown conversation/);
  });

  it('returns error when no repoRoot', async () => {
    const result = await branchFromConversation(
      { conversationId: 'c1' },
      {
        lookupConversation: () => ({ title: 'Hello' }),
        resolveRepoRoot: () => null,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no active workspace/);
  });

  it('rejects flag-shaped baseRef before invoking git', async () => {
    const runGit = vi.fn(async (_cwd: string, _args: readonly string[]) => ({
      stdout: '',
      stderr: '',
    }));
    const result = await branchFromConversation(
      { conversationId: 'c1', baseRef: '--upload-pack=evil' },
      {
        lookupConversation: () => ({ title: 'Hello' }),
        resolveRepoRoot: () => '/repo',
        runGit,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid baseRef/);
    const checkoutCall = runGit.mock.calls.find((call) => call[1][0] === 'checkout');
    expect(checkoutCall).toBeUndefined();
  });

  it('rejects invalid baseRef when git check-ref-format fails', async () => {
    const runGit = vi.fn(async (_cwd: string, args: readonly string[]) => {
      if (args[0] === 'check-ref-format') throw new Error('not a valid ref');
      return { stdout: '', stderr: '' };
    });
    const result = await branchFromConversation(
      { conversationId: 'c1', baseRef: 'has spaces' },
      {
        lookupConversation: () => ({ title: 'Hello' }),
        resolveRepoRoot: () => '/repo',
        runGit,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid baseRef/);
  });

  it('passes -- separator to git checkout so flag-shaped values are pathspecs', async () => {
    const runGit = vi.fn(async (_cwd: string, args: readonly string[]) => {
      if (args[0] === 'rev-parse') throw new Error('not a branch');
      return { stdout: '', stderr: '' };
    });
    const result = await branchFromConversation(
      { conversationId: 'c1', baseRef: 'main' },
      {
        lookupConversation: () => ({ title: 'Add Login' }),
        resolveRepoRoot: () => '/repo',
        runGit,
      },
    );
    expect(result.ok).toBe(true);
    const checkoutCall = runGit.mock.calls.find(
      ([, args]) => Array.isArray(args) && args[0] === 'checkout',
    );
    const checkoutArgs = checkoutCall?.[1] as string[] | undefined;
    expect(checkoutArgs).toContain('--');
  });

  it('runs git checkout -b with the slugified branch name', async () => {
    const runGit = vi.fn(async (_cwd: string, args: readonly string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--verify') {
        throw new Error('not a branch');
      }
      return { stdout: '', stderr: '' };
    });
    const result = await branchFromConversation(
      { conversationId: 'c1' },
      {
        lookupConversation: () => ({ title: 'Add Login Page' }),
        resolveRepoRoot: () => '/repo',
        runGit,
      },
    );
    expect(result.ok).toBe(true);
    expect(result.branch).toBe('oc/add-login-page');
    expect(result.repoRoot).toBe('/repo');
    const checkoutCall = runGit.mock.calls.find(
      ([, args]) => Array.isArray(args) && args[0] === 'checkout',
    );
    expect(checkoutCall).toBeDefined();
    const checkoutArgs = checkoutCall?.[1];
    expect(
      Array.isArray(checkoutArgs) && (checkoutArgs as string[]).includes('oc/add-login-page'),
    ).toBe(true);
  });
});

describe('scrubGitErrorMessage', () => {
  it('redacts user:password from URLs', () => {
    const out = scrubGitErrorMessage(
      'fatal: Authentication failed for https://user:secret@github.com/x.git',
    );
    expect(out).not.toContain('user:secret');
  });

  it('redacts bearer tokens', () => {
    const out = scrubGitErrorMessage('Bearer abcdef0123456789');
    expect(out).not.toContain('abcdef0123456789');
  });

  it('redacts password=… style env-shaped values', () => {
    const out = scrubGitErrorMessage('GIT_PASSWORD=supers3cret leaked');
    expect(out).not.toContain('supers3cret');
  });
});
