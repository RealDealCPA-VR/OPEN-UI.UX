import { describe, expect, it, vi } from 'vitest';
import { branchFromConversation, buildBranchName } from './branch-from-conversation';

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
