import type { ReviewFinding, ReviewSeverity } from '../../shared/review';

const SEVERITY_COLOR: Record<ReviewSeverity, { fg: string; bg: string; border: string }> = {
  bug: { fg: 'var(--danger)', bg: 'var(--danger-bg)', border: 'var(--danger-border)' },
  smell: { fg: 'var(--warn)', bg: 'var(--warn-bg)', border: 'var(--warn-border)' },
  style: { fg: 'var(--text-secondary)', bg: 'var(--bg-elevated)', border: 'var(--border)' },
  nit: { fg: 'var(--text-muted)', bg: 'var(--bg-sunken)', border: 'var(--border)' },
};

export interface ReviewFindingCardProps {
  finding: ReviewFinding;
  selected: boolean;
  onToggleSelected: () => void;
  onOpenInCodebase?: () => void;
  onCopyPrompt?: () => void;
}

export function ReviewFindingCard({
  finding,
  selected,
  onToggleSelected,
  onOpenInCodebase,
  onCopyPrompt,
}: ReviewFindingCardProps): JSX.Element {
  const palette = SEVERITY_COLOR[finding.severity];
  const lineRange =
    finding.startLine === finding.endLine
      ? `L${finding.startLine}`
      : `L${finding.startLine}-L${finding.endLine}`;

  return (
    <article
      className="review-finding-card"
      style={{
        border: `1px solid ${palette.border}`,
        borderRadius: 'var(--radius)',
        padding: 12,
        background: selected ? 'var(--bg-selected)' : 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition:
          'border-color var(--duration) var(--ease), background var(--duration) var(--ease)',
      }}
      data-severity={finding.severity}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          aria-label={`Select finding ${finding.title}`}
          style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
        />
        <span
          style={{
            background: palette.bg,
            color: palette.fg,
            border: `1px solid ${palette.border}`,
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill, 999px)',
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {finding.severity}
        </span>
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            color: 'var(--text-primary)',
            flex: 1,
            overflowWrap: 'anywhere',
          }}
        >
          {finding.title}
        </h3>
      </header>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 6 }}>
        <code style={{ overflowWrap: 'anywhere' }}>
          {finding.filePath}:{lineRange}
        </code>
      </div>
      <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.45 }}>
        {finding.rationale}
      </p>
      {finding.suggestedFix && (
        <pre
          style={{
            margin: 0,
            background: 'var(--bg-sunken)',
            color: 'var(--text-pre, var(--text-primary))',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 8,
            fontSize: 12,
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {finding.suggestedFix}
        </pre>
      )}
      {finding.retrievedContext.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)' }}>
          {finding.retrievedContext.map((ref, i) => (
            <li key={`${finding.id}-ctx-${i}`}>
              <code>{ref}</code>
            </li>
          ))}
        </ul>
      )}
      {(finding.auditPrompt || finding.auditRetrievedContext.length > 0) && (
        <details className="review-finding-audit" style={{ fontSize: 12 }}>
          <summary
            style={{
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              userSelect: 'none',
            }}
          >
            Show prompt &amp; retrieved context
          </summary>
          {finding.auditRetrievedContext.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: 4,
                }}
              >
                Retrieved context
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)' }}>
                {finding.auditRetrievedContext.map((snippet, i) => (
                  <li key={`${finding.id}-audit-ctx-${i}`} style={{ marginBottom: 2 }}>
                    <code style={{ whiteSpace: 'pre-wrap' }}>{snippet}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {finding.auditPrompt && (
            <div style={{ marginTop: 6 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: 4,
                }}
              >
                LLM prompt
              </div>
              <pre
                aria-label="Audit prompt"
                style={{
                  margin: 0,
                  background: 'var(--bg-sunken)',
                  color: 'var(--text-pre, var(--text-primary))',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 8,
                  fontSize: 11,
                  maxHeight: 240,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {finding.auditPrompt}
              </pre>
            </div>
          )}
        </details>
      )}
      <footer style={{ display: 'flex', gap: 8 }}>
        {onOpenInCodebase && (
          <button type="button" className="btn btn-sm" onClick={onOpenInCodebase}>
            Open in Codebase
          </button>
        )}
        {finding.prompt && onCopyPrompt && (
          <button type="button" className="btn btn-sm" onClick={onCopyPrompt}>
            Copy fix prompt
          </button>
        )}
      </footer>
    </article>
  );
}
