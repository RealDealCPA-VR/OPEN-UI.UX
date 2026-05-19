import { describe, expect, it } from 'vitest';
import {
  asEditFileResult,
  asGlobResult,
  asGrepResult,
  asListDirResult,
  asReadFileResult,
  asRunShellResult,
  asWebFetchResult,
  asWriteFileResult,
} from './tool-result-preview';

describe('asReadFileResult', () => {
  it('accepts the canonical shape', () => {
    expect(
      asReadFileResult({
        content: 'a\nb',
        totalLines: 2,
        startLine: 0,
        endLine: 2,
        truncated: false,
      }),
    ).toEqual({ content: 'a\nb', totalLines: 2, startLine: 0, endLine: 2, truncated: false });
  });

  it('rejects missing required fields', () => {
    expect(asReadFileResult({ content: 'a' })).toBeNull();
  });

  it('rejects wrong types', () => {
    expect(
      asReadFileResult({
        content: 'a',
        totalLines: '2',
        startLine: 0,
        endLine: 1,
        truncated: false,
      }),
    ).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(asReadFileResult(null)).toBeNull();
    expect(asReadFileResult('string')).toBeNull();
    expect(asReadFileResult([])).toBeNull();
  });
});

describe('asGrepResult', () => {
  it('accepts an empty array', () => {
    expect(asGrepResult([])).toEqual([]);
  });

  it('accepts a valid match list', () => {
    const matches = [
      { file: 'a.ts', line: 1, text: 'hello' },
      { file: 'b.ts', line: 42, text: 'world' },
    ];
    expect(asGrepResult(matches)).toEqual(matches);
  });

  it('rejects rows missing required fields', () => {
    expect(asGrepResult([{ file: 'a', line: 1 }])).toBeNull();
  });

  it('rejects when a row has wrong types', () => {
    expect(asGrepResult([{ file: 'a', line: '1', text: 't' }])).toBeNull();
  });

  it('rejects non-arrays', () => {
    expect(asGrepResult({ file: 'a', line: 1, text: 't' })).toBeNull();
  });
});

describe('asRunShellResult', () => {
  const valid = {
    stdout: 'hi\n',
    stderr: '',
    exitCode: 0,
    signal: null,
    truncatedStdout: false,
    truncatedStderr: false,
    timedOut: false,
    durationMs: 123,
  };

  it('accepts the canonical shape with exitCode + null signal', () => {
    expect(asRunShellResult(valid)).toEqual(valid);
  });

  it('accepts null exitCode (signal-terminated)', () => {
    const sig = { ...valid, exitCode: null, signal: 'SIGTERM' };
    expect(asRunShellResult(sig)).toEqual(sig);
  });

  it('rejects when exitCode is neither number nor null', () => {
    expect(asRunShellResult({ ...valid, exitCode: 'fail' })).toBeNull();
  });

  it('rejects missing flags', () => {
    const partial = { ...valid } as Record<string, unknown>;
    delete partial.truncatedStdout;
    expect(asRunShellResult(partial)).toBeNull();
  });
});

describe('asWebFetchResult', () => {
  const valid = {
    status: 200,
    headers: { 'content-type': 'text/plain' },
    body: 'ok',
    truncated: false,
    contentType: 'text/plain',
    finalUrl: 'https://example.com/',
  };

  it('accepts the canonical shape', () => {
    expect(asWebFetchResult(valid)).toEqual(valid);
  });

  it('accepts null contentType', () => {
    expect(asWebFetchResult({ ...valid, contentType: null })).toEqual({
      ...valid,
      contentType: null,
    });
  });

  it('drops non-string header values rather than rejecting', () => {
    const out = asWebFetchResult({
      ...valid,
      headers: { 'x-good': 'yes', 'x-bad': 7 },
    });
    expect(out?.headers).toEqual({ 'x-good': 'yes' });
  });

  it('rejects when headers is not an object', () => {
    expect(asWebFetchResult({ ...valid, headers: 'not-a-map' })).toBeNull();
  });
});

describe('asGlobResult', () => {
  it('accepts an array of strings', () => {
    expect(asGlobResult(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('accepts an empty array', () => {
    expect(asGlobResult([])).toEqual([]);
  });

  it('rejects arrays containing non-strings', () => {
    expect(asGlobResult(['a', 1])).toBeNull();
  });

  it('rejects non-arrays', () => {
    expect(asGlobResult({ paths: ['a'] })).toBeNull();
  });
});

describe('asListDirResult', () => {
  it('accepts known entry types', () => {
    const entries = [
      { name: 'src', type: 'dir' as const },
      { name: 'README.md', type: 'file' as const },
      { name: 'link', type: 'symlink' as const },
    ];
    expect(asListDirResult(entries)).toEqual(entries);
  });

  it('rejects unknown entry types', () => {
    expect(asListDirResult([{ name: 'x', type: 'fifo' }])).toBeNull();
  });

  it('rejects entries missing a name', () => {
    expect(asListDirResult([{ type: 'file' }])).toBeNull();
  });
});

describe('asWriteFileResult and asEditFileResult', () => {
  it('asWriteFileResult accepts bytesWritten:number', () => {
    expect(asWriteFileResult({ bytesWritten: 42 })).toEqual({ bytesWritten: 42 });
  });

  it('asWriteFileResult rejects bytesWritten:string', () => {
    expect(asWriteFileResult({ bytesWritten: '42' })).toBeNull();
  });

  it('asEditFileResult accepts replacements:number', () => {
    expect(asEditFileResult({ replacements: 3 })).toEqual({ replacements: 3 });
  });

  it('asEditFileResult rejects missing replacements', () => {
    expect(asEditFileResult({})).toBeNull();
  });
});
