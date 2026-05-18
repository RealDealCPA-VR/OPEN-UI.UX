import { useState } from 'react';
import type { ToolResultBlock, ToolUseBlock } from '@opencodex/core';
import { formatToolArguments, formatToolOutput } from './tool-block-grouping';

interface ToolCallCardProps {
  use: ToolUseBlock;
  result: ToolResultBlock | null;
  defaultExpanded?: boolean;
}

type Status = 'pending' | 'done' | 'error';

export function ToolCallCard({
  use,
  result,
  defaultExpanded = false,
}: ToolCallCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const status: Status = result === null ? 'pending' : result.isError ? 'error' : 'done';
  const argsText = formatToolArguments(use.arguments);
  const outputText = result ? formatToolOutput(result.output) : '';

  return (
    <div className={`tool-card tool-card-${status}`}>
      <button
        type="button"
        className="tool-card-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="tool-card-chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="tool-card-name">{use.name}</span>
        <ToolStatusPill status={status} />
      </button>
      {expanded ? (
        <div className="tool-card-body">
          {argsText.length > 0 ? (
            <ToolPanel label="Arguments" body={argsText} />
          ) : (
            <p className="tool-card-empty">No arguments</p>
          )}
          {result ? (
            <ToolPanel
              label={result.isError ? 'Error' : 'Result'}
              body={outputText.length > 0 ? outputText : '(empty)'}
              tone={result.isError ? 'error' : 'ok'}
            />
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
