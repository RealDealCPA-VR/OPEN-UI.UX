import { useState } from 'react';
import type { ReviewSource } from '../../shared/review';

export interface ReviewSourcePickerProps {
  initial?: ReviewSource;
  disabled?: boolean;
  onSubmit: (source: ReviewSource) => void;
}

type Kind = ReviewSource['kind'];

export function ReviewSourcePicker({
  initial,
  disabled,
  onSubmit,
}: ReviewSourcePickerProps): JSX.Element {
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'local-branch');
  const [base, setBase] = useState<string>(
    initial && initial.kind === 'local-branch' ? initial.base : 'main',
  );
  const [head, setHead] = useState<string>(
    initial && initial.kind === 'local-branch' ? initial.head : 'HEAD',
  );
  const [prUrl, setPrUrl] = useState<string>(
    initial && initial.kind === 'gh-pr-url' ? initial.url : '',
  );
  const [prNumber, setPrNumber] = useState<string>(
    initial && initial.kind === 'github-pr-number' ? String(initial.number) : '',
  );
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    setError(null);
    if (kind === 'local-branch') {
      if (!base.trim() || !head.trim()) {
        setError('Base and head refs are required');
        return;
      }
      onSubmit({ kind: 'local-branch', base: base.trim(), head: head.trim() });
      return;
    }
    if (kind === 'gh-pr-url') {
      const trimmed = prUrl.trim();
      if (!/^https?:\/\//.test(trimmed)) {
        setError('Enter a valid PR URL (https://...)');
        return;
      }
      onSubmit({ kind: 'gh-pr-url', url: trimmed });
      return;
    }
    const n = Number.parseInt(prNumber.trim(), 10);
    if (!Number.isFinite(n) || n <= 0) {
      setError('PR number must be a positive integer');
      return;
    }
    onSubmit({ kind: 'github-pr-number', number: n });
  };

  return (
    <div
      className="review-source-picker"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <fieldset
        style={{
          display: 'flex',
          gap: 12,
          padding: 0,
          border: 'none',
          margin: 0,
        }}
      >
        <legend style={{ fontSize: 12, color: 'var(--text-secondary)', padding: 0 }}>Source</legend>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="radio"
            name="review-source-kind"
            value="local-branch"
            checked={kind === 'local-branch'}
            onChange={() => setKind('local-branch')}
            disabled={disabled}
          />
          <span>Local branch</span>
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="radio"
            name="review-source-kind"
            value="github-pr-number"
            checked={kind === 'github-pr-number'}
            onChange={() => setKind('github-pr-number')}
            disabled={disabled}
          />
          <span>GitHub PR #</span>
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="radio"
            name="review-source-kind"
            value="gh-pr-url"
            checked={kind === 'gh-pr-url'}
            onChange={() => setKind('gh-pr-url')}
            disabled={disabled}
          />
          <span>PR URL</span>
        </label>
      </fieldset>

      {kind === 'local-branch' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Base</span>
            <input
              type="text"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              disabled={disabled}
              placeholder="main"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Head</span>
            <input
              type="text"
              value={head}
              onChange={(e) => setHead(e.target.value)}
              disabled={disabled}
              placeholder="HEAD"
            />
          </label>
        </div>
      )}

      {kind === 'gh-pr-url' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>PR URL</span>
          <input
            type="url"
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            disabled={disabled}
            placeholder="https://github.com/owner/repo/pull/123"
          />
        </label>
      )}

      {kind === 'github-pr-number' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>PR #</span>
          <input
            type="number"
            min={1}
            value={prNumber}
            onChange={(e) => setPrNumber(e.target.value)}
            disabled={disabled}
            placeholder="123"
          />
        </label>
      )}

      {error && <p style={{ color: 'var(--danger)', fontSize: 12, margin: 0 }}>{error}</p>}

      <div>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={disabled}>
          Fetch diff
        </button>
      </div>
    </div>
  );
}
