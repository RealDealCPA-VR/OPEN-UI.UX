import { describe, expect, it } from 'vitest';
import { deriveWebPrUrlFromRemote } from './draft-pr';

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
});
