import { useState } from 'react';
import type { ToolResultBlock, ToolUseBlock } from '@opencodex/core';
import { formatRerunPrompt, formatToolArguments, formatToolOutput } from './tool-block-grouping';
import { ToolResultPreview } from './tool-result-preview';

interface ToolCallCardProps {
  use: ToolUseBlock;
  result: ToolResultBlock | null;
  defaultExpanded?: boolean;
  onRerun?: (prompt: string) => void;
}

type Status = 'pending' | 'done' | 'error';

export function ToolCallCard({
  use,
  result,
  defaultExpanded = false,
  onRerun,
}: ToolCallCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const status: Status = result === null ? 'pending' : result.isError ? 'error' : 'done';
  const argsText = formatToolArguments(use.arguments);
  const outputText = result ? formatToolOutput(result.output) : '';

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
    </div>
  );
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
