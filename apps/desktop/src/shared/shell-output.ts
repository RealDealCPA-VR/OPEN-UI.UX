/**
 * Shell output streaming types — used by the embedded terminal and run_shell wiring.
 *
 * v1: a single ShellOutputEvent is broadcast after run_shell completes (one frame containing
 * the joined stdout + stderr). The schema accommodates future true-streaming where multiple
 * frames per tool call are emitted; renderer side already handles N events filtered by streamId.
 */

export type ShellOutputStream = 'stdout' | 'stderr' | 'meta';

export interface ShellOutputEvent {
  /** ID of the chat stream this output came from */
  streamId: string;
  /** ID of the tool_use block in that chat stream */
  toolUseId: string;
  /** stdout, stderr, or meta (banner / status lines from the tool runner) */
  stream: ShellOutputStream;
  /** UTF-8 chunk. May contain ANSI escape codes — the embedded terminal interprets them. */
  chunk: string;
  /** Set true on the final frame for a given toolUseId */
  final: boolean;
}

const DEFAULT_MAX_BYTES = 1024 * 1024;
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';

export interface BuildShellTranscriptInput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  truncatedStdout: boolean;
  truncatedStderr: boolean;
  timedOut: boolean;
  durationMs: number;
  command?: string;
  cwd?: string;
}

/**
 * Build a single transcript chunk that mimics what a human would have seen in a real shell:
 * - a dim banner with command + cwd
 * - the stdout bytes verbatim (ANSI codes preserved)
 * - the stderr bytes verbatim in dim red (ANSI codes preserved — xterm interprets them)
 * - a footer with exit code, signal, duration, and any truncation/timeout warnings
 *
 * Lines are joined with CRLF because xterm.js needs explicit \r before \n to return the cursor.
 */
export function buildShellTranscript(input: BuildShellTranscriptInput): string {
  const parts: string[] = [];
  if (input.command) {
    parts.push(`${DIM}$ ${input.command}${RESET}`);
  }
  if (input.cwd) {
    parts.push(`${DIM}  (cwd: ${input.cwd})${RESET}`);
  }
  if (input.stdout.length > 0) {
    parts.push(toCrlf(input.stdout));
  }
  if (input.stderr.length > 0) {
    parts.push(`${RED}${toCrlf(input.stderr)}${RESET}`);
  }
  parts.push(buildFooter(input));
  return parts.join('\r\n');
}

function buildFooter(input: BuildShellTranscriptInput): string {
  const segments: string[] = [];
  if (input.timedOut) {
    segments.push(`${YELLOW}timed out${RESET}`);
  } else if (input.exitCode === 0) {
    segments.push(`${GREEN}exit 0${RESET}`);
  } else if (input.exitCode !== null) {
    segments.push(`${RED}exit ${input.exitCode}${RESET}`);
  } else {
    segments.push(`${YELLOW}no exit code${RESET}`);
  }
  if (input.signal) {
    segments.push(`signal ${input.signal}`);
  }
  segments.push(formatDuration(input.durationMs));
  if (input.truncatedStdout) {
    segments.push(`${YELLOW}stdout truncated${RESET}`);
  }
  if (input.truncatedStderr) {
    segments.push(`${YELLOW}stderr truncated${RESET}`);
  }
  return `${DIM}── ${segments.join('  ')}${RESET}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * xterm needs CRLF, but tools usually emit LF. Convert lone LFs to CRLF; leave existing CRLF alone.
 */
export function toCrlf(s: string): string {
  if (s.length === 0) return s;
  return s.replace(/\r?\n/g, '\r\n');
}

/**
 * Append-only output buffer with a byte cap. Once the cap is reached, further appends are
 * dropped and `truncated` flips to true. UTF-8 byte counting (best-effort via TextEncoder).
 */
export class OutputBuffer {
  private chunks: string[] = [];
  private bytes = 0;
  private readonly cap: number;
  private capHit = false;

  constructor(maxBytes: number = DEFAULT_MAX_BYTES) {
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new Error('maxBytes must be a positive integer');
    }
    this.cap = maxBytes;
  }

  append(chunk: string): void {
    if (chunk.length === 0 || this.capHit) return;
    const chunkBytes = byteLength(chunk);
    if (this.bytes + chunkBytes <= this.cap) {
      this.chunks.push(chunk);
      this.bytes += chunkBytes;
      return;
    }
    const remaining = this.cap - this.bytes;
    if (remaining > 0) {
      this.chunks.push(sliceByBytes(chunk, remaining));
      this.bytes = this.cap;
    }
    this.capHit = true;
  }

  get truncated(): boolean {
    return this.capHit;
  }

  get byteLength(): number {
    return this.bytes;
  }

  toString(): string {
    return this.chunks.join('');
  }
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function sliceByBytes(s: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8');
  const encoded = encoder.encode(s);
  if (encoded.length <= maxBytes) return s;
  return decoder.decode(encoded.subarray(0, maxBytes));
}

/**
 * Strip ANSI escape sequences. Used by non-terminal previews + by tests that want to assert
 * on plain text. The embedded terminal renders the originals.
 *
 * Covers: CSI (\x1b[...), OSC (\x1b]...BEL or ST), simple two-byte sequences (\x1b<one char>).
 */
export function stripAnsi(s: string): string {
  if (s.length === 0) return s;
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[@-Z\\-_]/g, '')
  );
}
