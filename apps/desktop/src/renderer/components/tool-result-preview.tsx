import type { ToolResultBlock, ToolUseBlock } from '@opencodex/core';
import { formatToolOutput } from './tool-block-grouping';

const MAX_GREP_ROWS = 200;
const MAX_READ_LINES = 500;
const MAX_LIST_ROWS = 500;

interface ReadFileResultShape {
  content: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

interface GrepMatchShape {
  file: string;
  line: number;
  text: string;
}

interface RunShellResultShape {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  truncatedStdout: boolean;
  truncatedStderr: boolean;
  timedOut: boolean;
  durationMs: number;
}

interface WebFetchResultShape {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  contentType: string | null;
  finalUrl: string;
}

interface DirEntryShape {
  name: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
}

interface ToolResultPreviewProps {
  use: ToolUseBlock;
  result: ToolResultBlock;
}

export function ToolResultPreview({ use, result }: ToolResultPreviewProps): JSX.Element {
  if (result.isError) {
    return <ErrorResultPreview output={result.output} />;
  }
  switch (use.name) {
    case 'read_file': {
      const r = asReadFileResult(result.output);
      if (r) return <ReadFileResultPreview result={r} />;
      break;
    }
    case 'grep': {
      const r = asGrepResult(result.output);
      if (r) return <GrepResultPreview matches={r} />;
      break;
    }
    case 'run_shell': {
      const r = asRunShellResult(result.output);
      if (r) return <RunShellResultPreview result={r} />;
      break;
    }
    case 'web_fetch': {
      const r = asWebFetchResult(result.output);
      if (r) return <WebFetchResultPreview result={r} />;
      break;
    }
    case 'glob': {
      const r = asGlobResult(result.output);
      if (r) return <GlobResultPreview paths={r} />;
      break;
    }
    case 'list_dir': {
      const r = asListDirResult(result.output);
      if (r) return <ListDirResultPreview entries={r} />;
      break;
    }
    case 'write_file': {
      const r = asWriteFileResult(result.output);
      if (r) return <WriteFileResultPreview bytesWritten={r.bytesWritten} />;
      break;
    }
    case 'edit_file': {
      const r = asEditFileResult(result.output);
      if (r) return <EditFileResultPreview replacements={r.replacements} />;
      break;
    }
  }
  return <JsonResultPreview output={result.output} />;
}

function ReadFileResultPreview({ result }: { result: ReadFileResultShape }): JSX.Element {
  const allLines = result.content.length === 0 ? [] : result.content.split(/\r?\n/);
  const visible = allLines.slice(0, MAX_READ_LINES);
  const truncatedForDisplay = allLines.length > MAX_READ_LINES;

  return (
    <section className="tool-result-preview tool-result-preview-read">
      <div className="tool-result-meta">
        <span className="tool-result-meta-item">{result.totalLines.toLocaleString()} lines</span>
        <span className="tool-result-meta-item">
          showing {result.startLine + 1}–{result.endLine}
        </span>
        {result.truncated ? (
          <span className="tool-result-meta-item tool-result-meta-warn">tool truncated</span>
        ) : null}
      </div>
      {visible.length === 0 ? (
        <p className="tool-result-empty">(empty)</p>
      ) : (
        <div className="tool-result-code-numbered" role="presentation">
          {visible.map((line, i) => (
            <div key={i} className="tool-result-code-line">
              <span className="tool-result-code-lineno">{result.startLine + 1 + i}</span>
              <span className="tool-result-code-text">{line}</span>
            </div>
          ))}
        </div>
      )}
      {truncatedForDisplay ? (
        <p className="tool-result-note">
          Display truncated: showing first {visible.length.toLocaleString()} of{' '}
          {allLines.length.toLocaleString()} lines returned.
        </p>
      ) : null}
    </section>
  );
}

function GrepResultPreview({ matches }: { matches: GrepMatchShape[] }): JSX.Element {
  if (matches.length === 0) {
    return <p className="tool-result-empty">No matches</p>;
  }
  const visible = matches.slice(0, MAX_GREP_ROWS);
  const hidden = matches.length - visible.length;
  return (
    <section className="tool-result-preview tool-result-preview-grep">
      <div className="tool-result-meta">
        <span className="tool-result-meta-item">
          {matches.length.toLocaleString()} match{matches.length === 1 ? '' : 'es'}
        </span>
      </div>
      <ul className="tool-result-grep-list">
        {visible.map((m, i) => (
          <li key={i} className="tool-result-grep-row">
            <code className="tool-result-grep-loc">
              {m.file}:{m.line}
            </code>
            <code className="tool-result-grep-text">{m.text}</code>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="tool-result-note">+{hidden.toLocaleString()} more match(es) not shown</p>
      ) : null}
    </section>
  );
}

function RunShellResultPreview({ result }: { result: RunShellResultShape }): JSX.Element {
  const exitTone: ResultStatusTone = result.timedOut
    ? 'warn'
    : result.exitCode === 0
      ? 'ok'
      : 'error';
  const exitLabel = result.timedOut
    ? 'timed out'
    : result.exitCode !== null
      ? `exit ${result.exitCode}`
      : 'no exit code';
  return (
    <section className="tool-result-preview tool-result-preview-shell">
      <div className="tool-result-meta">
        <span className={`tool-result-status tool-result-status-${exitTone}`}>{exitLabel}</span>
        {result.signal ? (
          <span className="tool-result-meta-item">signal {result.signal}</span>
        ) : null}
        <span className="tool-result-meta-item">{formatDuration(result.durationMs)}</span>
      </div>
      {result.stdout.length > 0 ? (
        <ShellStream label="stdout" body={result.stdout} truncated={result.truncatedStdout} />
      ) : null}
      {result.stderr.length > 0 ? (
        <ShellStream
          label="stderr"
          body={result.stderr}
          truncated={result.truncatedStderr}
          tone="error"
        />
      ) : null}
      {result.stdout.length === 0 && result.stderr.length === 0 ? (
        <p className="tool-result-empty">(no output)</p>
      ) : null}
    </section>
  );
}

function ShellStream({
  label,
  body,
  truncated,
  tone = 'ok',
}: {
  label: string;
  body: string;
  truncated: boolean;
  tone?: 'ok' | 'error';
}): JSX.Element {
  return (
    <div className="tool-result-shell-stream">
      <header className="tool-result-stream-label">{label}</header>
      <pre className={`tool-result-shell-pre tool-result-shell-pre-${tone}`}>{body}</pre>
      {truncated ? <p className="tool-result-note">{label} truncated at byte cap</p> : null}
    </div>
  );
}

function WebFetchResultPreview({ result }: { result: WebFetchResultShape }): JSX.Element {
  const statusTone: ResultStatusTone =
    result.status >= 500
      ? 'error'
      : result.status >= 400
        ? 'warn'
        : result.status >= 300
          ? 'info'
          : 'ok';
  const headerEntries = Object.entries(result.headers);
  return (
    <section className="tool-result-preview tool-result-preview-fetch">
      <div className="tool-result-meta">
        <span className={`tool-result-status tool-result-status-${statusTone}`}>
          {result.status}
        </span>
        {result.contentType ? (
          <span className="tool-result-meta-item">{result.contentType}</span>
        ) : null}
        {result.truncated ? (
          <span className="tool-result-meta-item tool-result-meta-warn">body truncated</span>
        ) : null}
      </div>
      <dl className="approval-preview-kv">
        <div className="approval-preview-kv-row">
          <dt>url</dt>
          <dd>
            <code>{result.finalUrl}</code>
          </dd>
        </div>
        {headerEntries.length > 0 ? (
          <div className="approval-preview-kv-row">
            <dt>headers</dt>
            <dd>
              <ul className="approval-preview-headers">
                {headerEntries.map(([k, v]) => (
                  <li key={k}>
                    <code>{k}</code>: <code>{v}</code>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
      {result.body.length > 0 ? (
        <pre className="tool-result-body">{result.body}</pre>
      ) : (
        <p className="tool-result-empty">(empty body)</p>
      )}
    </section>
  );
}

function GlobResultPreview({ paths }: { paths: string[] }): JSX.Element {
  if (paths.length === 0) {
    return <p className="tool-result-empty">No matches</p>;
  }
  const visible = paths.slice(0, MAX_LIST_ROWS);
  const hidden = paths.length - visible.length;
  return (
    <section className="tool-result-preview tool-result-preview-glob">
      <div className="tool-result-meta">
        <span className="tool-result-meta-item">
          {paths.length.toLocaleString()} match{paths.length === 1 ? '' : 'es'}
        </span>
      </div>
      <ul className="tool-result-path-list">
        {visible.map((p, i) => (
          <li key={`${p}-${i}`}>
            <code>{p}</code>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="tool-result-note">+{hidden.toLocaleString()} more path(s) not shown</p>
      ) : null}
    </section>
  );
}

function ListDirResultPreview({ entries }: { entries: DirEntryShape[] }): JSX.Element {
  if (entries.length === 0) {
    return <p className="tool-result-empty">(empty directory)</p>;
  }
  const visible = entries.slice(0, MAX_LIST_ROWS);
  const hidden = entries.length - visible.length;
  return (
    <section className="tool-result-preview tool-result-preview-list">
      <div className="tool-result-meta">
        <span className="tool-result-meta-item">
          {entries.length.toLocaleString()} entr{entries.length === 1 ? 'y' : 'ies'}
        </span>
      </div>
      <ul className="tool-result-dir-list">
        {visible.map((e, i) => (
          <li
            key={`${e.name}-${i}`}
            className={`tool-result-dir-row tool-result-dir-row-${e.type}`}
          >
            <span className="tool-result-dir-icon" aria-hidden="true">
              {dirIcon(e.type)}
            </span>
            <code>{e.name}</code>
            {e.type === 'symlink' || e.type === 'other' ? (
              <span className="tool-result-dir-kind">{e.type}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="tool-result-note">+{hidden.toLocaleString()} more entr(y/ies) not shown</p>
      ) : null}
    </section>
  );
}

function WriteFileResultPreview({ bytesWritten }: { bytesWritten: number }): JSX.Element {
  return (
    <section className="tool-result-preview tool-result-preview-write">
      <div className="tool-result-meta">
        <span className="tool-result-status tool-result-status-ok">
          Wrote {formatBytes(bytesWritten)}
        </span>
      </div>
    </section>
  );
}

function EditFileResultPreview({ replacements }: { replacements: number }): JSX.Element {
  return (
    <section className="tool-result-preview tool-result-preview-edit">
      <div className="tool-result-meta">
        <span className="tool-result-status tool-result-status-ok">
          {replacements.toLocaleString()} replacement{replacements === 1 ? '' : 's'}
        </span>
      </div>
    </section>
  );
}

function ErrorResultPreview({ output }: { output: unknown }): JSX.Element {
  const text = formatToolOutput(output);
  return <pre className="tool-card-pre tool-card-pre-error">{text || '(no message)'}</pre>;
}

function JsonResultPreview({ output }: { output: unknown }): JSX.Element {
  const text = formatToolOutput(output);
  return <pre className="tool-card-pre tool-card-pre-ok">{text || '(empty)'}</pre>;
}

type ResultStatusTone = 'ok' | 'warn' | 'error' | 'info';

function dirIcon(type: DirEntryShape['type']): string {
  switch (type) {
    case 'dir':
      return '▸';
    case 'file':
      return '·';
    case 'symlink':
      return '↪';
    default:
      return '?';
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function asReadFileResult(v: unknown): ReadFileResultShape | null {
  if (!isRecord(v)) return null;
  const { content, totalLines, startLine, endLine, truncated } = v;
  if (
    typeof content !== 'string' ||
    typeof totalLines !== 'number' ||
    typeof startLine !== 'number' ||
    typeof endLine !== 'number' ||
    typeof truncated !== 'boolean'
  ) {
    return null;
  }
  return { content, totalLines, startLine, endLine, truncated };
}

export function asGrepResult(v: unknown): GrepMatchShape[] | null {
  if (!Array.isArray(v)) return null;
  const out: GrepMatchShape[] = [];
  for (const item of v) {
    if (!isRecord(item)) return null;
    const { file, line, text } = item;
    if (typeof file !== 'string' || typeof line !== 'number' || typeof text !== 'string') {
      return null;
    }
    out.push({ file, line, text });
  }
  return out;
}

export function asRunShellResult(v: unknown): RunShellResultShape | null {
  if (!isRecord(v)) return null;
  const {
    stdout,
    stderr,
    exitCode,
    signal,
    truncatedStdout,
    truncatedStderr,
    timedOut,
    durationMs,
  } = v;
  if (
    typeof stdout !== 'string' ||
    typeof stderr !== 'string' ||
    (exitCode !== null && typeof exitCode !== 'number') ||
    (signal !== null && typeof signal !== 'string') ||
    typeof truncatedStdout !== 'boolean' ||
    typeof truncatedStderr !== 'boolean' ||
    typeof timedOut !== 'boolean' ||
    typeof durationMs !== 'number'
  ) {
    return null;
  }
  return {
    stdout,
    stderr,
    exitCode: exitCode as number | null,
    signal: signal as string | null,
    truncatedStdout,
    truncatedStderr,
    timedOut,
    durationMs,
  };
}

export function asWebFetchResult(v: unknown): WebFetchResultShape | null {
  if (!isRecord(v)) return null;
  const { status, headers, body, truncated, contentType, finalUrl } = v;
  if (
    typeof status !== 'number' ||
    !isRecord(headers) ||
    typeof body !== 'string' ||
    typeof truncated !== 'boolean' ||
    (contentType !== null && typeof contentType !== 'string') ||
    typeof finalUrl !== 'string'
  ) {
    return null;
  }
  const filteredHeaders: Record<string, string> = {};
  for (const [k, val] of Object.entries(headers)) {
    if (typeof val === 'string') filteredHeaders[k] = val;
  }
  return {
    status,
    headers: filteredHeaders,
    body,
    truncated,
    contentType: contentType as string | null,
    finalUrl,
  };
}

export function asGlobResult(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  for (const item of v) {
    if (typeof item !== 'string') return null;
  }
  return v as string[];
}

export function asListDirResult(v: unknown): DirEntryShape[] | null {
  if (!Array.isArray(v)) return null;
  const out: DirEntryShape[] = [];
  for (const item of v) {
    if (!isRecord(item)) return null;
    const { name, type } = item;
    if (typeof name !== 'string') return null;
    if (type !== 'file' && type !== 'dir' && type !== 'symlink' && type !== 'other') return null;
    out.push({ name, type });
  }
  return out;
}

export function asWriteFileResult(v: unknown): { bytesWritten: number } | null {
  if (!isRecord(v)) return null;
  const { bytesWritten } = v;
  if (typeof bytesWritten !== 'number') return null;
  return { bytesWritten };
}

export function asEditFileResult(v: unknown): { replacements: number } | null {
  if (!isRecord(v)) return null;
  const { replacements } = v;
  if (typeof replacements !== 'number') return null;
  return { replacements };
}
