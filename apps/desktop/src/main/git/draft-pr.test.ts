import { describe, expect, it } from 'vitest';
import { deriveWebPrUrlFromRemote, redactSecrets } from './draft-pr';

describe('deriveWebPrUrlFromRemote', () => {
  it('returns null for unsupported remotes', () => {
    expect(deriveWebPrUrlFromRemote('ftp://example.com/foo', 'feat')).toBeNull();
  });

  it('builds a github compare URL from https', () => {
    const url = deriveWebPrUrlFromRemote('https://github.com/owner/repo.git', 'feat-x', 'main');
    expect(url).toBe('https://github.com/owner/repo/compare/main...feat-x?expand=1');
  });

  it('builds a github compare URL from ssh', () => {
    const url = deriveWebPrUrlFromRemote('git@github.com:owner/repo.git', 'feat-x');
    expect(url).toBe('https://github.com/owner/repo/compare/main...feat-x?expand=1');
  });

  it('builds a gitlab merge request URL', () => {
    const url = deriveWebPrUrlFromRemote('git@gitlab.com:group/proj.git', 'work');
    expect(url).toBe(
      'https://gitlab.com/group/proj/-/merge_requests/new?merge_request[source_branch]=work',
    );
  });

  it('builds a bitbucket pull request URL', () => {
    const url = deriveWebPrUrlFromRemote('https://bitbucket.org/team/repo.git', 'feature');
    expect(url).toBe('https://bitbucket.org/team/repo/pull-requests/new?source=feature');
  });

  it('url-encodes branch names with slashes', () => {
    const url = deriveWebPrUrlFromRemote('https://github.com/owner/repo', 'feat/x');
    expect(url).toContain('feat%2Fx');
  });

  it('rejects look-alike github hosts that merely include "github"', () => {
    expect(
      deriveWebPrUrlFromRemote('https://github.evil.com/owner/repo.git', 'feat', 'main'),
    ).toBeNull();
    expect(
      deriveWebPrUrlFromRemote('https://evilgithub.com/owner/repo.git', 'feat', 'main'),
    ).toBeNull();
  });

  it('accepts github.com and *.github.com (GHE) hosts only', () => {
    expect(deriveWebPrUrlFromRemote('https://github.com/owner/repo.git', 'feat', 'main')).toContain(
      'https://github.com/',
    );
    expect(
      deriveWebPrUrlFromRemote('https://ghe.corp.github.com/owner/repo.git', 'feat', 'main'),
    ).toContain('https://ghe.corp.github.com/');
  });
});

describe('redactSecrets', () => {
  it('redacts AWS access keys', () => {
    const out = redactSecrets('key=AKIAIOSFODNN7EXAMPLE in config');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out).toContain('[redacted:aws-access-key]');
  });

  it('redacts GitHub personal access tokens', () => {
    const out = redactSecrets('token: ghp_abcdefghijklmnopqrstuvwx1234567890ab');
    expect(out).not.toContain('ghp_abcdefghijklmnopqrstuvwx1234567890ab');
    expect(out).toContain('[redacted:github-pat]');
  });

  it('redacts OpenAI-style sk- keys', () => {
    const out = redactSecrets('OPENAI_API_KEY=sk-abcdefghijklmnopqrstuv');
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuv');
  });

  it('redacts password JSON fields', () => {
    const out = redactSecrets('{"password": "hunter2", "x": 1}');
    expect(out).not.toContain('hunter2');
  });

  it('redacts URLs with embedded credentials', () => {
    const out = redactSecrets('clone https://user:pass@example.com/x.git');
    expect(out).not.toContain('user:pass');
  });

  it('leaves clean diffs unchanged', () => {
    const clean = 'diff --git a/foo b/foo\n+const x = 1;\n';
    expect(redactSecrets(clean)).toBe(clean);
  });
});
