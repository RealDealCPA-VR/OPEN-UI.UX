import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalScope,
  FilePreviewResult,
} from '../../shared/approvals';
import { diffLines, type DiffResult } from './line-diff';

const sessionCommandAllowlist = new Map<string, true>();

function extractShellCommand(req: ApprovalRequest): string | null {
  if (req.toolName !== 'run_shell') return null;
  const args = asRunShellArgs(req.arguments);
  return args ? args.command : null;
}

function toolIconLetter(toolName: string): string {
  return (toolName[0] ?? '?').toUpperCase();
}

const MonacoDiffViewer = lazy(async () => {
  const mod = await import('./MonacoDiffViewer');
  return { default: mod.MonacoDiffViewer };
});

export function ApprovalQueue(): JSX.Element | null {
  const [queue, setQueue] = useState<ApprovalRequest[]>([]);

  useEffect(() => {
    return window.opencodex.approvals.onRequest((req) => {
      const cmd = extractShellCommand(req);
      if (cmd !== null && sessionCommandAllowlist.has(cmd)) {
        void window.opencodex.approvals.respond({
          requestId: req.requestId,
          decision: 'allow',
          scope: 'session',
        });
        return;
      }
      setQueue((prev) => [...prev, req]);
    });
  }, []);

  const respond = useCallback(
    async (request: ApprovalRequest, decision: ApprovalDecision, scope: ApprovalScope) => {
      try {
        await window.opencodex.approvals.respond({
          requestId: request.requestId,
          decision,
          scope,
        });
      } finally {
        setQueue((prev) => prev.filter((r) => r.requestId !== request.requestId));
      }
    },
    [],
  );

  const allowExactCommand = useCallback(
    (request: ApprovalRequest) => {
      const cmd = extractShellCommand(request);
      if (cmd !== null) sessionCommandAllowlist.set(cmd, true);
      void respond(request, 'allow', 'session');
    },
    [respond],
  );

  const current = queue[0] ?? null;
  const buttonsRef = useRef<HTMLButtonElement[]>([]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      const idx = '123456'.indexOf(e.key);
      if (idx === -1) return;
      const btn = buttonsRef.current[idx];
      if (btn && !btn.disabled) {
        e.preventDefault();
        btn.click();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current]);

  if (!current) return null;

  const shellCommand = extractShellCommand(current);

  const registerBtn = (slot: number) => (el: HTMLButtonElement | null) => {
    // eslint-disable-next-line react-hooks/refs
    if (el) buttonsRef.current[slot] = el;
  };

  return (
    <div className="approval-modal-backdrop" role="dialog" aria-modal="true">
      <div className="approval-modal">
        <header className="approval-modal-header">
          <span
            className={`approval-tool-icon approval-tool-icon-${current.permissionTier}`}
            aria-hidden="true"
          >
            {toolIconLetter(current.toolName)}
          </span>
          <div className="approval-modal-header-text">
            <span className={`approval-modal-tier tool-tier tool-tier-${current.permissionTier}`}>
              {current.permissionTier}
            </span>
            <h2>{current.toolName}</h2>
          </div>
        </header>
        <p className="approval-modal-description">{current.toolDescription}</p>
        <ApprovalPreview request={current} />
        {queue.length > 1 && (
          <p className="approval-modal-queue">
            {queue.length - 1} more approval{queue.length - 1 === 1 ? '' : 's'} pending
          </p>
        )}
        <div className="approval-modal-actions">
          <div className="approval-modal-action-group">
            <button ref={registerBtn(0)} onClick={() => void respond(current, 'allow', 'once')}>
              <span className="approval-kbd">1</span>Allow once
            </button>
            <button ref={registerBtn(1)} onClick={() => void respond(current, 'allow', 'session')}>
              <span className="approval-kbd">2</span>Allow session
            </button>
            <button ref={registerBtn(2)} onClick={() => void respond(current, 'allow', 'always')}>
              <span className="approval-kbd">3</span>Allow always
            </button>
          </div>
          <div className="approval-modal-action-group">
            <button ref={registerBtn(3)} onClick={() => void respond(current, 'deny', 'once')}>
              <span className="approval-kbd">4</span>Deny once
            </button>
            <button ref={registerBtn(4)} onClick={() => void respond(current, 'deny', 'session')}>
              <span className="approval-kbd">5</span>Deny session
            </button>
            <button ref={registerBtn(5)} onClick={() => void respond(current, 'deny', 'always')}>
              <span className="approval-kbd">6</span>Deny always
            </button>
          </div>
          {shellCommand !== null ? (
            <div className="approval-modal-action-group approval-modal-action-extra">
              <button
                type="button"
                className="approval-modal-extra-btn"
                onClick={() => allowExactCommand(current)}
                title={shellCommand}
              >
                Always allow this exact command
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ApprovalPreview({ request }: { request: ApprovalRequest }): JSX.Element {
  switch (request.toolName) {
    case 'write_file': {
      const args = asWriteFileArgs(request.arguments);
      if (args) return <WriteFilePreview path={args.path} content={args.content} />;
      break;
    }
    case 'edit_file': {
      const args = asEditFileArgs(request.arguments);
      if (args) return <EditFilePreview args={args} />;
      break;
    }
    case 'run_shell': {
      const args = asRunShellArgs(request.arguments);
      if (args) return <RunShellPreview args={args} />;
      break;
    }
    case 'web_fetch': {
      const args = asWebFetchArgs(request.arguments);
      if (args) return <WebFetchPreview args={args} />;
      break;
    }
  }
  return <JsonArgsPreview args={request.arguments} />;
}

function WriteFilePreview({ path, content }: { path: string; content: string }): JSX.Element {
  const [existing, setExisting] = useState<FilePreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monacoOpen, setMonacoOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      setExisting(null);
      setError(null);
      try {
        const res = await window.opencodex.approvals.readFilePreview({ path });
        if (!cancelled) setExisting(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  const newBytes = useMemo(() => new TextEncoder().encode(content).length, [content]);
  const diff = useMemo<DiffResult | null>(() => {
    if (!existing) return null;
    return diffLines(existing.content, content);
  }, [existing, content]);

  return (
    <section className="approval-preview approval-preview-write">
      <header className="approval-preview-head">
        <span className="approval-preview-label">write_file</span>
        <code className="approval-preview-path">{path}</code>
      </header>
      <div className="approval-preview-meta">
        {existing === null && !error ? (
          <span className="approval-preview-meta-item">Loading current contents…</span>
        ) : null}
        {error ? (
          <span className="approval-preview-meta-item approval-preview-meta-error">
            Could not read current file: {error}
          </span>
        ) : null}
        {existing ? (
          existing.exists ? (
            <>
              <span className="approval-preview-meta-item">Overwrites existing file</span>
              <span className="approval-preview-meta-item">
                {formatBytes(existing.sizeBytes)} → {formatBytes(newBytes)}
              </span>
              {diff ? (
                <span className="approval-preview-meta-item approval-preview-meta-diff">
                  <span className="approval-diff-add-stat">+{diff.added}</span>
                  <span className="approval-diff-remove-stat">−{diff.removed}</span>
                </span>
              ) : null}
            </>
          ) : (
            <>
              <span className="approval-preview-meta-item approval-preview-meta-new">New file</span>
              <span className="approval-preview-meta-item">{formatBytes(newBytes)}</span>
            </>
          )
        ) : null}
      </div>
      {existing?.truncated ? (
        <p className="approval-preview-note">
          Current file is larger than preview cap ({formatBytes(existing.sizeBytes)}); diff is based
          on the first {formatBytes(existing.content.length)}.
        </p>
      ) : null}
      {existing && existing.exists && diff ? (
        <DiffView diff={diff} />
      ) : existing && !existing.exists ? (
        <pre className="approval-preview-code approval-preview-code-add">{content}</pre>
      ) : null}
      {existing ? (
        <div className="approval-preview-monaco-launcher">
          <button
            type="button"
            className="approval-preview-monaco-toggle"
            onClick={() => setMonacoOpen(true)}
          >
            View in Monaco
          </button>
        </div>
      ) : null}
      {monacoOpen && existing ? (
        <MonacoDiffModal
          path={path}
          originalText={existing.exists ? existing.content : ''}
          modifiedText={content}
          language={guessLanguageFromPath(path)}
          onClose={() => setMonacoOpen(false)}
        />
      ) : null}
    </section>
  );
}

function EditFileMonacoLauncher({
  path,
  oldString,
  newString,
  replaceAll,
}: {
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}): JSX.Element {
  const [existing, setExisting] = useState<FilePreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monacoOpen, setMonacoOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      setExisting(null);
      setError(null);
      try {
        const res = await window.opencodex.approvals.readFilePreview({ path });
        if (!cancelled) setExisting(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  const modifiedText = useMemo(() => {
    if (!existing || !existing.exists) return newString;
    return replaceAll
      ? existing.content.split(oldString).join(newString)
      : existing.content.replace(oldString, newString);
  }, [existing, oldString, newString, replaceAll]);

  return (
    <div className="approval-preview-monaco-launcher">
      {error ? (
        <span className="approval-preview-meta-error">Could not read file: {error}</span>
      ) : null}
      <button
        type="button"
        className="approval-preview-monaco-toggle"
        disabled={!existing}
        onClick={() => setMonacoOpen(true)}
      >
        View in Monaco
      </button>
      {monacoOpen && existing ? (
        <MonacoDiffModal
          path={path}
          originalText={existing.exists ? existing.content : ''}
          modifiedText={modifiedText}
          language={guessLanguageFromPath(path)}
          onClose={() => setMonacoOpen(false)}
        />
      ) : null}
    </div>
  );
}

function MonacoDiffModal({
  path,
  originalText,
  modifiedText,
  language,
  onClose,
}: {
  path: string;
  originalText: string;
  modifiedText: string;
  language?: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      className="approval-monaco-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Monaco diff for ${path}`}
      onClick={onClose}
    >
      <div className="approval-monaco-modal" onClick={(e) => e.stopPropagation()}>
        <header className="approval-monaco-modal-header">
          <code className="approval-monaco-modal-path">{path}</code>
          <button
            type="button"
            className="approval-monaco-modal-close"
            onClick={onClose}
            aria-label="Close Monaco diff"
          >
            ×
          </button>
        </header>
        <Suspense
          fallback={<div className="approval-monaco-modal-loading">Loading Monaco editor…</div>}
        >
          <MonacoDiffViewer
            originalText={originalText}
            modifiedText={modifiedText}
            language={language}
            height="60vh"
          />
        </Suspense>
      </div>
    </div>
  );
}

function guessLanguageFromPath(path: string): string | undefined {
  const lower = path.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.') + 1);
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'json':
      return 'json';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'css':
      return 'css';
    case 'html':
    case 'htm':
      return 'html';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'sh':
    case 'bash':
      return 'shell';
    default:
      return undefined;
  }
}

function EditFilePreview({
  args,
}: {
  args: { path: string; oldString: string; newString: string; replaceAll?: boolean };
}): JSX.Element {
  return (
    <section className="approval-preview approval-preview-edit">
      <header className="approval-preview-head">
        <span className="approval-preview-label">edit_file</span>
        <code className="approval-preview-path">{args.path}</code>
      </header>
      <div className="approval-preview-meta">
        <span className="approval-preview-meta-item">
          {args.replaceAll ? 'Replace all occurrences' : 'Replace single match'}
        </span>
      </div>
      <div className="approval-edit-pair">
        <div className="approval-edit-side approval-edit-side-old">
          <header className="approval-edit-side-head">Replace</header>
          <pre className="approval-preview-code approval-preview-code-remove">{args.oldString}</pre>
        </div>
        <div className="approval-edit-side approval-edit-side-new">
          <header className="approval-edit-side-head">With</header>
          <pre className="approval-preview-code approval-preview-code-add">{args.newString}</pre>
        </div>
      </div>
      <EditFileMonacoLauncher
        path={args.path}
        oldString={args.oldString}
        newString={args.newString}
        {...(args.replaceAll !== undefined ? { replaceAll: args.replaceAll } : {})}
      />
    </section>
  );
}

function RunShellPreview({
  args,
}: {
  args: { command: string; cwd?: string; timeoutMs?: number; maxOutputBytes?: number };
}): JSX.Element {
  return (
    <section className="approval-preview approval-preview-shell">
      <header className="approval-preview-head">
        <span className="approval-preview-label">run_shell</span>
      </header>
      <pre className="approval-preview-command">{args.command}</pre>
      <dl className="approval-preview-kv">
        <div className="approval-preview-kv-row">
          <dt>cwd</dt>
          <dd>
            <code>{args.cwd ?? '(workspace root)'}</code>
          </dd>
        </div>
        {args.timeoutMs !== undefined ? (
          <div className="approval-preview-kv-row">
            <dt>timeout</dt>
            <dd>{args.timeoutMs.toLocaleString()} ms</dd>
          </div>
        ) : null}
        {args.maxOutputBytes !== undefined ? (
          <div className="approval-preview-kv-row">
            <dt>max output</dt>
            <dd>{formatBytes(args.maxOutputBytes)}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function WebFetchPreview({
  args,
}: {
  args: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}): JSX.Element {
  let hostname = '';
  try {
    hostname = new URL(args.url).hostname;
  } catch {
    hostname = '(invalid URL)';
  }
  const method = args.method ?? 'GET';
  const headerEntries = Object.entries(args.headers ?? {});

  return (
    <section className="approval-preview approval-preview-fetch">
      <header className="approval-preview-head">
        <span className={`approval-preview-method approval-preview-method-${method.toLowerCase()}`}>
          {method}
        </span>
        <code className="approval-preview-url">{args.url}</code>
      </header>
      <dl className="approval-preview-kv">
        <div className="approval-preview-kv-row">
          <dt>host</dt>
          <dd>
            <code>{hostname}</code>
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
      {args.body !== undefined && args.body.length > 0 ? (
        <pre className="approval-preview-code">{args.body}</pre>
      ) : null}
    </section>
  );
}

function JsonArgsPreview({ args }: { args: unknown }): JSX.Element {
  return <pre className="approval-modal-args">{formatArgs(args)}</pre>;
}

function DiffView({ diff }: { diff: DiffResult }): JSX.Element {
  return (
    <div className="approval-diff">
      {diff.lines.map((line, idx) => (
        <div key={idx} className={`approval-diff-line approval-diff-line-${line.kind}`}>
          <span className="approval-diff-gutter">
            {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
          </span>
          <span className="approval-diff-lineno">{line.oldLine ?? ''}</span>
          <span className="approval-diff-lineno">{line.newLine ?? ''}</span>
          <span className="approval-diff-text">{line.text}</span>
        </div>
      ))}
      {diff.truncated ? (
        <p className="approval-preview-note">
          Diff truncated. Showing first {diff.lines.length} lines; full change is +{diff.added} / −
          {diff.removed}.
        </p>
      ) : null}
    </div>
  );
}

function formatArgs(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asWriteFileArgs(v: unknown): { path: string; content: string } | null {
  if (!isRecord(v)) return null;
  const { path, content } = v;
  if (typeof path !== 'string' || typeof content !== 'string') return null;
  return { path, content };
}

function asEditFileArgs(
  v: unknown,
): { path: string; oldString: string; newString: string; replaceAll?: boolean } | null {
  if (!isRecord(v)) return null;
  const { path, oldString, newString, replaceAll } = v;
  if (typeof path !== 'string' || typeof oldString !== 'string' || typeof newString !== 'string') {
    return null;
  }
  return {
    path,
    oldString,
    newString,
    ...(typeof replaceAll === 'boolean' ? { replaceAll } : {}),
  };
}

function asRunShellArgs(
  v: unknown,
): { command: string; cwd?: string; timeoutMs?: number; maxOutputBytes?: number } | null {
  if (!isRecord(v)) return null;
  const { command, cwd, timeoutMs, maxOutputBytes } = v;
  if (typeof command !== 'string') return null;
  return {
    command,
    ...(typeof cwd === 'string' ? { cwd } : {}),
    ...(typeof timeoutMs === 'number' ? { timeoutMs } : {}),
    ...(typeof maxOutputBytes === 'number' ? { maxOutputBytes } : {}),
  };
}

function asWebFetchArgs(
  v: unknown,
): { url: string; method?: string; headers?: Record<string, string>; body?: string } | null {
  if (!isRecord(v)) return null;
  const { url, method, headers, body } = v;
  if (typeof url !== 'string') return null;
  const out: { url: string; method?: string; headers?: Record<string, string>; body?: string } = {
    url,
  };
  if (typeof method === 'string') out.method = method;
  if (isRecord(headers)) {
    const filtered: Record<string, string> = {};
    for (const [k, val] of Object.entries(headers)) {
      if (typeof val === 'string') filtered[k] = val;
    }
    out.headers = filtered;
  }
  if (typeof body === 'string') out.body = body;
  return out;
}
