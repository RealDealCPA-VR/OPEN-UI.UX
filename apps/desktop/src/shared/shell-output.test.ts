import { describe, expect, it } from 'vitest';
import { OutputBuffer, buildShellTranscript, stripAnsi, toCrlf } from './shell-output';

describe('toCrlf', () => {
  it('returns empty string unchanged', () => {
    expect(toCrlf('')).toBe('');
  });

  it('converts lone LF to CRLF', () => {
    expect(toCrlf('a\nb\nc')).toBe('a\r\nb\r\nc');
  });

  it('leaves existing CRLF alone', () => {
    expect(toCrlf('a\r\nb')).toBe('a\r\nb');
  });

  it('does not double-CRLF a mixed input', () => {
    expect(toCrlf('a\r\nb\nc')).toBe('a\r\nb\r\nc');
  });
});

describe('stripAnsi', () => {
  it('strips simple CSI color codes', () => {
    expect(stripAnsi('\x1b[31merror\x1b[0m')).toBe('error');
  });

  it('strips OSC sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07rest')).toBe('rest');
  });

  it('passes plain text through', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });

  it('returns empty for empty input', () => {
    expect(stripAnsi('')).toBe('');
  });
});

describe('buildShellTranscript', () => {
  it('renders command banner, stdout, and exit-0 footer', () => {
    const t = buildShellTranscript({
      stdout: 'hello\n',
      stderr: '',
      exitCode: 0,
      signal: null,
      truncatedStdout: false,
      truncatedStderr: false,
      timedOut: false,
      durationMs: 42,
      command: 'echo hello',
      cwd: '/tmp/x',
    });
    const plain = stripAnsi(t);
    expect(plain).toContain('$ echo hello');
    expect(plain).toContain('(cwd: /tmp/x)');
    expect(plain).toContain('hello');
    expect(plain).toContain('exit 0');
    expect(plain).toContain('42 ms');
  });

  it('marks non-zero exit codes', () => {
    const t = buildShellTranscript({
      stdout: '',
      stderr: 'boom',
      exitCode: 1,
      signal: null,
      truncatedStdout: false,
      truncatedStderr: false,
      timedOut: false,
      durationMs: 100,
    });
    const plain = stripAnsi(t);
    expect(plain).toContain('exit 1');
    expect(plain).toContain('boom');
  });

  it('flags timeouts in the footer', () => {
    const t = buildShellTranscript({
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: 'SIGTERM',
      truncatedStdout: false,
      truncatedStderr: false,
      timedOut: true,
      durationMs: 30_000,
    });
    const plain = stripAnsi(t);
    expect(plain).toContain('timed out');
    expect(plain).toContain('signal SIGTERM');
    expect(plain).toContain('30.0 s');
  });

  it('notes both stdout and stderr truncation', () => {
    const t = buildShellTranscript({
      stdout: 'a',
      stderr: 'b',
      exitCode: 0,
      signal: null,
      truncatedStdout: true,
      truncatedStderr: true,
      timedOut: false,
      durationMs: 5,
    });
    const plain = stripAnsi(t);
    expect(plain).toContain('stdout truncated');
    expect(plain).toContain('stderr truncated');
  });

  it('preserves ANSI escape codes from stdout untouched', () => {
    const colored = '\x1b[32mok\x1b[0m';
    const t = buildShellTranscript({
      stdout: colored,
      stderr: '',
      exitCode: 0,
      signal: null,
      truncatedStdout: false,
      truncatedStderr: false,
      timedOut: false,
      durationMs: 1,
    });
    expect(t.includes(colored)).toBe(true);
  });

  it('joins parts with CRLF so xterm can render newlines', () => {
    const t = buildShellTranscript({
      stdout: 'line1\nline2',
      stderr: '',
      exitCode: 0,
      signal: null,
      truncatedStdout: false,
      truncatedStderr: false,
      timedOut: false,
      durationMs: 1,
      command: 'cmd',
    });
    expect(t).toContain('\r\n');
    expect(t).not.toMatch(/[^\r]\n/);
  });
});

describe('OutputBuffer', () => {
  it('appends chunks and exposes the joined string', () => {
    const buf = new OutputBuffer(1024);
    buf.append('hello ');
    buf.append('world');
    expect(buf.toString()).toBe('hello world');
    expect(buf.truncated).toBe(false);
    expect(buf.byteLength).toBe(11);
  });

  it('ignores empty chunks', () => {
    const buf = new OutputBuffer(10);
    buf.append('');
    expect(buf.toString()).toBe('');
    expect(buf.byteLength).toBe(0);
  });

  it('truncates at the byte cap and flips truncated=true', () => {
    const buf = new OutputBuffer(5);
    buf.append('1234567');
    expect(buf.toString().length).toBe(5);
    expect(buf.truncated).toBe(true);
  });

  it('discards further appends once truncated', () => {
    const buf = new OutputBuffer(3);
    buf.append('abc');
    buf.append('def');
    expect(buf.toString()).toBe('abc');
    expect(buf.truncated).toBe(true);
  });

  it('counts multi-byte UTF-8 chars by byte length, not code points', () => {
    // "é" = 2 UTF-8 bytes; cap of 3 bytes fits one é + one ASCII
    const buf = new OutputBuffer(3);
    buf.append('é');
    buf.append('a');
    expect(buf.byteLength).toBeLessThanOrEqual(3);
    expect(buf.truncated).toBe(false);
    buf.append('b');
    expect(buf.truncated).toBe(true);
  });

  it('rejects non-positive caps', () => {
    expect(() => new OutputBuffer(0)).toThrow();
    expect(() => new OutputBuffer(-1)).toThrow();
    expect(() => new OutputBuffer(1.5)).toThrow();
  });
});
