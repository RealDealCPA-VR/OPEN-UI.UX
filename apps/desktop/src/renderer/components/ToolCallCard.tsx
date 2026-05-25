import { lazy, Suspense, useState } from 'react';
import type { ToolResultBlock, ToolUseBlock } from '@opencodex/core';
import { buildShellTranscript } from '../../shared/shell-output';
import { formatRerunPrompt, formatToolArguments, formatToolOutput } from './tool-block-grouping';
import { ToolResultPreview, asRunShellResult } from './tool-result-preview';

const EmbeddedTerminal = lazy(() =>
  import('./EmbeddedTerminal').then((m) => ({ default: m.EmbeddedTerminal })),
);

interface ToolCallCardProps {
  use: ToolUseBlock;
  result: ToolResultBlock | null;
  /** Chat stream id — used to filter live shell:output frames in the embedded terminal */
  streamId?: string;
  defaultExpanded?: boolean;
  onRerun?: (prompt: string) => void;
}

type Status = 'pending' | 'done' | 'error';

export function ToolCallCard({
  use,
  result,
  streamId,
  defaultExpanded = false,
  onRerun,
}: ToolCallCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const status: Status = result === null ? 'pending' : result.isError ? 'error' : 'done';
  const argsText = formatToolArguments(use.arguments);
  const outputText = result ? formatToolOutput(result.output) : '';
  const isShell = use.name === 'run_shell';
  const shellResult = isShell && result && !result.isError ? asRunShellResult(result.output) : null;
  const canShowTerminal = isShell && shellResult !== null;

  return (
    <div className={`tool-card tool-card-${status}`}>
      <div className="tool-card-head">
        <button
          type="button"
          className="tool-card-head-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="tool-card-chevron" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
          <span className="tool-card-name">{use.name}</span>
        </button>
        <ToolStatusPill status={status} />
        {canShowTerminal ? (
          <button
            type="button"
            className={`tool-card-pill tool-card-pill-terminal${terminalOpen ? ' is-active' : ''}`}
            onClick={() => setTerminalOpen((v) => !v)}
            aria-pressed={terminalOpen}
            aria-label={terminalOpen ? 'Hide embedded terminal' : 'Show embedded terminal'}
            title="View output in an embedded terminal (xterm.js)"
          >
            Terminal
          </button>
        ) : null}
        {onRerun ? (
          <button
            type="button"
            className="tool-card-rerun"
            onClick={() => onRerun(formatRerunPrompt(use.name, use.arguments))}
            disabled={status === 'pending'}
            aria-label={`Re-run ${use.name}`}
            title={
              status === 'pending'
                ? 'Re-run available once this call finishes'
                : 'Prefill the composer with this tool call'
            }
          >
            Re-run
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="tool-card-body">
          {argsText.length > 0 ? (
            <ToolPanel label="Arguments" body={argsText} />
          ) : (
            <p className="tool-card-empty">No arguments</p>
          )}
          {result ? (
            <ResultPanel use={use} result={result} rawText={outputText} />
          ) : (
            <p className="tool-card-empty">Awaiting result…</p>
          )}
        </div>
      ) : null}
      {terminalOpen && canShowTerminal && shellResult ? (
        <TerminalPanel
          streamId={streamId ?? ''}
          toolUseId={use.id}
          command={extractCommand(use.arguments)}
          cwd={extractCwd(use.arguments)}
          shellResult={shellResult}
        />
      ) : null}
    </div>
  );
}

function TerminalPanel({
  streamId,
  toolUseId,
  command,
  cwd,
  shellResult,
}: {
  streamId: string;
  toolUseId: string;
  command: string | undefined;
  cwd: string | undefined;
  shellResult: NonNullable<ReturnType<typeof asRunShellResult>>;
}): JSX.Element {
  const transcript =
    buildShellTranscript({
      stdout: shellResult.stdout,
      stderr: shellResult.stderr,
      exitCode: shellResult.exitCode,
      signal: shellResult.signal,
      truncatedStdout: shellResult.truncatedStdout,
      truncatedStderr: shellResult.truncatedStderr,
      timedOut: shellResult.timedOut,
      durationMs: shellResult.durationMs,
      ...(command ? { command } : {}),
      ...(cwd ? { cwd } : {}),
    }) + '\r\n';
  return (
    <section className="tool-card-terminal" aria-label="Embedded terminal">
      <Suspense fallback={<p className="embedded-terminal-status">Loading terminal…</p>}>
        <EmbeddedTerminal streamId={streamId} toolUseId={toolUseId} initialContent={transcript} />
      </Suspense>
    </section>
  );
}

function extractCommand(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const v = (args as Record<string, unknown>).command;
  return typeof v === 'string' ? v : undefined;
}

function extractCwd(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const v = (args as Record<string, unknown>).cwd;
  return typeof v === 'string' ? v : undefined;
}

function ToolStatusPill({ status }: { status: Status }): JSX.Element {
  const label = status === 'pending' ? 'Running' : status === 'error' ? 'Error' : 'Done';
  return <span className={`tool-card-pill tool-card-pill-${status}`}>{label}</span>;
}

function ToolPanel({
  label,
  body,
  tone = 'ok',
}: {
  label: string;
  body: string;
  tone?: 'ok' | 'error';
}): JSX.Element {
  return (
    <section className="tool-card-panel">
      <header className="tool-card-panel-head">
        <span className="tool-card-panel-label">{label}</span>
        <button
          type="button"
          className="tool-card-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(body);
          }}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          Copy
        </button>
      </header>
      <pre className={`tool-card-pre tool-card-pre-${tone}`}>{body}</pre>
    </section>
  );
}

function ResultPanel({
  use,
  result,
  rawText,
}: {
  use: ToolUseBlock;
  result: ToolResultBlock;
  rawText: string;
}): JSX.Element {
  const label = result.isError ? 'Error' : 'Result';
  const copyText = rawText.length > 0 ? rawText : '(empty)';
  return (
    <section className="tool-card-panel">
      <header className="tool-card-panel-head">
        <span className="tool-card-panel-label">{label}</span>
        <button
          type="button"
          className="tool-card-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(copyText);
          }}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          Copy
        </button>
      </header>
      <ToolResultPreview use={use} result={result} />
    </section>
  );
}
