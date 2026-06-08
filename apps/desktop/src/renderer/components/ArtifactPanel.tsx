import { useMemo, useState } from 'react';
import { Markdown } from './Markdown';
import {
  artifactExtension,
  artifactLabel,
  type Artifact,
  type ArtifactKind,
} from './extract-artifacts';

// Wrap raw HTML/SVG into a minimal, theme-neutral document for the sandboxed
// iframe. The host page's tokens don't cross the iframe boundary, so we inline a
// light, readable baseline.
function buildSrcDoc(kind: Exclude<ArtifactKind, 'markdown'>, code: string): string {
  const base = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:16px;background:#ffffff;color:#1a1a1a;
    font-family:-apple-system,Segoe UI,system-ui,sans-serif;line-height:1.5;}
  svg{max-width:100%;height:auto;}
</style></head><body>`;
  return `${base}${code}</body></html>`;
}

export function ArtifactPanel({
  artifact,
  onClose,
}: {
  artifact: Artifact;
  onClose: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  const srcDoc = useMemo(
    () => (artifact.kind === 'markdown' ? '' : buildSrcDoc(artifact.kind, artifact.code)),
    [artifact.kind, artifact.code],
  );

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(artifact.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard may reject without a gesture/permission — ignore.
    }
  };

  const onDownload = (): void => {
    const blob = new Blob([artifact.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `artifact.${artifactExtension(artifact.kind)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="artifact-panel" aria-label="Artifact preview">
      <header className="artifact-panel-head">
        <span className="artifact-panel-title">{artifactLabel(artifact.kind)}</span>
        <div className="artifact-panel-actions">
          <button type="button" className="btn btn-ghost btn-tiny" onClick={() => void onCopy()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="btn btn-ghost btn-tiny" onClick={onDownload}>
            Download
          </button>
          <button
            type="button"
            className="artifact-panel-close"
            onClick={onClose}
            aria-label="Close preview"
            title="Close preview"
          >
            ×
          </button>
        </div>
      </header>
      <div className="artifact-panel-body">
        {artifact.kind === 'markdown' ? (
          <div className="artifact-panel-md md">
            <Markdown text={artifact.code} />
          </div>
        ) : (
          <iframe
            className="artifact-panel-frame"
            title="Artifact preview"
            sandbox={artifact.kind === 'html' ? 'allow-scripts' : ''}
            srcDoc={srcDoc}
          />
        )}
      </div>
    </aside>
  );
}
