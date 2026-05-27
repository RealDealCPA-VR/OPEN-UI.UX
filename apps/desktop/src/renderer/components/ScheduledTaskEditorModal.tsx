import { useCallback, useEffect, useMemo, useState } from 'react';
import cronParser from 'cron-parser';
import type { RunnerInfo, RunnerInstallCheck } from '../../shared/ipc-types';
import type {
  CreateScheduledTaskRequest,
  ScheduledTask,
  UpdateScheduledTaskRequest,
} from '../../shared/scheduled-tasks';
import type { Trigger, TriggerType } from '../../shared/triggers';
import type { ToolListItem } from '../../shared/tools';
import { useSelectedModel } from '../state/selected-model-context';

export interface PrefillFromSkill {
  name: string;
  description: string;
  prompt: string;
  allowedTools: string[];
  cron: string | null;
  linkedSkillId: string;
}

export interface ScheduledTaskEditorModalProps {
  task: ScheduledTask | null;
  prefill?: PrefillFromSkill | null;
  onClose: () => void;
  onSaved: (task: ScheduledTask) => void;
}

interface CronPreset {
  label: string;
  expr: string;
}

const CRON_PRESETS: readonly CronPreset[] = [
  { label: 'Hourly', expr: '0 * * * *' },
  { label: 'Daily 9 AM UTC', expr: '0 9 * * *' },
  { label: 'Weekly Mon 9 AM UTC', expr: '0 9 * * 1' },
  { label: 'Every 5 minutes', expr: '*/5 * * * *' },
];

function previewNext(expr: string, count = 5): string[] {
  try {
    const it = cronParser.parseExpression(expr, { tz: 'UTC' });
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      out.push(it.next().toISOString());
    }
    return out;
  } catch {
    return [];
  }
}

export function ScheduledTaskEditorModal({
  task,
  prefill,
  onClose,
  onSaved,
}: ScheduledTaskEditorModalProps): JSX.Element {
  const { configuredProviders } = useSelectedModel();
  const isEdit = task !== null;

  const initialName = task?.name ?? prefill?.name ?? '';
  const initialDescription = task?.description ?? prefill?.description ?? '';
  const initialPrompt = task?.prompt ?? prefill?.prompt ?? '';
  const initialAllowedTools = task?.allowedTools ?? prefill?.allowedTools ?? [];
  const initialTriggerType: TriggerType = task?.trigger.type ?? (prefill?.cron ? 'cron' : 'cron');
  const initialCronExpr =
    task?.trigger.type === 'cron' ? task.trigger.expr : (prefill?.cron ?? '0 9 * * *');
  const initialGlob = task?.trigger.type === 'file-change' ? task.trigger.glob : '**/*.ts';
  const initialHook: 'post-commit' | 'pre-push' =
    task?.trigger.type === 'git-hook' ? task.trigger.hook : 'post-commit';
  const initialWebhookSecret = task?.trigger.type === 'webhook' ? task.trigger.secret : '';
  const initialLinkedSkillId = task?.linkedSkillId ?? prefill?.linkedSkillId ?? null;
  const isLinkedToSkill = initialLinkedSkillId !== null;

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [triggerType, setTriggerType] = useState<TriggerType>(initialTriggerType);
  const [cronExpr, setCronExpr] = useState<string>(initialCronExpr);
  const [glob, setGlob] = useState<string>(initialGlob);
  const [gitHook, setGitHook] = useState<'post-commit' | 'pre-push'>(initialHook);
  const [webhookSecret, setWebhookSecret] = useState<string>(initialWebhookSecret);
  const [webhookSecretRevealed, setWebhookSecretRevealed] = useState<boolean>(
    initialWebhookSecret.length === 0,
  );
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [providerId, setProviderId] = useState<string>(
    task?.providerId ?? configuredProviders[0]?.info.id ?? '',
  );
  const [model, setModel] = useState<string>(task?.model ?? '');
  const [workspacePath, setWorkspacePath] = useState<string>(task?.workspacePath ?? '');
  const [allowedTools, setAllowedTools] = useState<string[]>(initialAllowedTools);
  const [useWorktree, setUseWorktree] = useState<boolean>(task?.useWorktree ?? true);
  const [enabled, setEnabled] = useState<boolean>(task?.enabled ?? true);
  const [linkedSkillId] = useState<string | null>(initialLinkedSkillId);
  const [tools, setTools] = useState<ToolListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runnerId, setRunnerId] = useState<string>(task?.runnerId ?? 'internal');
  const [runners, setRunners] = useState<RunnerInfo[]>([]);
  const [installState, setInstallState] = useState<Record<string, RunnerInstallCheck | undefined>>(
    {},
  );

  useEffect(() => {
    void window.opencodex.tools
      .list()
      .then((list) => setTools(list))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchAndCheck = async (): Promise<void> => {
      try {
        const list = await window.opencodex.agent.listRunners();
        if (cancelled) return;
        setRunners(list);
        for (const r of list) {
          if (r.source === 'builtin') continue;
          void window.opencodex.agent
            .checkRunnerInstalled(r.id)
            .then((status) => {
              if (cancelled) return;
              setInstallState((prev) => ({ ...prev, [r.id]: status }));
            })
            .catch(() => undefined);
        }
      } catch {
        // leave runners empty; selector will fall back to internal
      }
    };
    void fetchAndCheck();
    const off = window.opencodex.agent.onRunnersChanged(() => {
      void fetchAndCheck();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    if (workspacePath) return;
    void window.opencodex.workspace
      .get()
      .then((s) => {
        if (s.active) setWorkspacePath(s.active);
      })
      .catch(() => undefined);
  }, [workspacePath]);

  // Fetch the inbound URL for an existing webhook / git-hook task so we can
  // show it (with a copy button). Only meaningful when we're editing.
  useEffect(() => {
    if (!task) return;
    if (task.trigger.type !== 'webhook' && task.trigger.type !== 'git-hook') return;
    void window.opencodex.scheduler
      .getTriggerUrl(task.id)
      .then((res) => setWebhookUrl(res.url))
      .catch(() => undefined);
  }, [task]);

  const providerOptions = useMemo(
    () =>
      configuredProviders.map((p) => ({
        id: p.info.id,
        displayName: p.info.displayName,
        models: p.info.models.filter((m) => !m.embeddings),
      })),
    [configuredProviders],
  );

  const modelOptions = useMemo(() => {
    const provider = providerOptions.find((p) => p.id === providerId);
    return provider?.models ?? [];
  }, [providerOptions, providerId]);

  const effectiveModel =
    model && modelOptions.some((m) => m.id === model) ? model : (modelOptions[0]?.id ?? '');

  const cronPreview = useMemo(() => {
    if (triggerType !== 'cron') return [];
    return previewNext(cronExpr, 5);
  }, [triggerType, cronExpr]);

  const cronValid = triggerType !== 'cron' || cronPreview.length > 0;

  const handleBrowseWorkspace = useCallback(async () => {
    try {
      const next = await window.opencodex.workspace.browse();
      if (next.active) setWorkspacePath(next.active);
    } catch {
      // dialog cancelled
    }
  }, []);

  const toggleTool = useCallback((name: string) => {
    setAllowedTools((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  const isExternalRunner = runnerId !== 'internal';
  const effectiveUseWorktreeSave = isExternalRunner ? true : useWorktree;

  const submit = useCallback(async () => {
    setError(null);
    if (!name.trim() || !prompt.trim() || !workspacePath) {
      setError('Fill in name, prompt, and workspace.');
      return;
    }
    if (!isExternalRunner && (!providerId || !effectiveModel)) {
      setError('Fill in provider and model for the built-in runner.');
      return;
    }
    if (triggerType === 'cron' && !cronValid) {
      setError('Cron expression is invalid.');
      return;
    }
    if (triggerType === 'file-change' && !glob.trim()) {
      setError('File-change trigger needs a glob.');
      return;
    }
    if (triggerType === 'webhook' && (!webhookSecret || webhookSecret.length < 16)) {
      setError('Webhook secret must be at least 16 characters.');
      return;
    }
    let trigger: Trigger;
    switch (triggerType) {
      case 'manual':
        trigger = { type: 'manual' };
        break;
      case 'cron':
        trigger = { type: 'cron', expr: cronExpr };
        break;
      case 'file-change':
        trigger = { type: 'file-change', glob: glob.trim() };
        break;
      case 'git-hook':
        // hookSecret is generated server-side; the editor doesn't carry it.
        trigger = { type: 'git-hook', hook: gitHook };
        break;
      case 'webhook':
        trigger = { type: 'webhook', secret: webhookSecret };
        break;
    }
    setBusy(true);
    try {
      let saved: ScheduledTask;
      if (isEdit && task) {
        const req: UpdateScheduledTaskRequest = {
          id: task.id,
          name: name.trim(),
          description: description.trim(),
          trigger,
          prompt: prompt.trim(),
          providerId,
          model: effectiveModel,
          workspacePath,
          allowedTools,
          useWorktree: effectiveUseWorktreeSave,
          enabled,
          runnerId,
        };
        saved = await window.opencodex.scheduler.updateTask(req);
      } else {
        const req: CreateScheduledTaskRequest = {
          name: name.trim(),
          description: description.trim(),
          trigger,
          prompt: prompt.trim(),
          providerId,
          model: effectiveModel,
          workspacePath,
          allowedTools,
          useWorktree: effectiveUseWorktreeSave,
          enabled,
          runnerId,
          ...(linkedSkillId ? { linkedSkillId } : {}),
        };
        saved = await window.opencodex.scheduler.createTask(req);
      }
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [
    name,
    description,
    triggerType,
    cronExpr,
    cronValid,
    glob,
    gitHook,
    webhookSecret,
    prompt,
    providerId,
    effectiveModel,
    workspacePath,
    allowedTools,
    effectiveUseWorktreeSave,
    enabled,
    linkedSkillId,
    isEdit,
    task,
    onSaved,
    runnerId,
    isExternalRunner,
  ]);

  const generateRandomSecret = useCallback(() => {
    // 32 hex chars, browser-side via crypto.getRandomValues
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    const hex = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
    setWebhookSecret(hex);
    setWebhookSecretRevealed(true);
  }, []);

  const copyWebhookUrl = useCallback(() => {
    if (!webhookUrl) return;
    void navigator.clipboard.writeText(webhookUrl).catch(() => undefined);
  }, [webhookUrl]);

  return (
    <div className="approval-modal-backdrop" role="dialog" aria-modal="true">
      <div className="approval-modal agent-spawn-modal scheduled-task-editor">
        <header className="approval-modal-header">
          <h2>{isEdit ? 'Edit scheduled task' : 'New scheduled task'}</h2>
        </header>

        <label className="agent-spawn-field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nightly docs sync"
            autoFocus
          />
        </label>

        <label className="agent-spawn-field">
          <span>Description (optional)</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this task does"
          />
        </label>

        <fieldset className="scheduled-task-trigger">
          <legend>Trigger</legend>
          <label>
            <input
              type="radio"
              name="trigger-type"
              value="manual"
              checked={triggerType === 'manual'}
              onChange={() => setTriggerType('manual')}
            />
            Manual (Run-now only)
          </label>
          <label>
            <input
              type="radio"
              name="trigger-type"
              value="cron"
              checked={triggerType === 'cron'}
              onChange={() => setTriggerType('cron')}
            />
            Cron
          </label>
          <label>
            <input
              type="radio"
              name="trigger-type"
              value="file-change"
              checked={triggerType === 'file-change'}
              onChange={() => setTriggerType('file-change')}
            />
            File change
          </label>
          <label>
            <input
              type="radio"
              name="trigger-type"
              value="git-hook"
              checked={triggerType === 'git-hook'}
              onChange={() => setTriggerType('git-hook')}
            />
            Git hook
          </label>
          <label>
            <input
              type="radio"
              name="trigger-type"
              value="webhook"
              checked={triggerType === 'webhook'}
              onChange={() => setTriggerType('webhook')}
            />
            Webhook
          </label>
          {triggerType === 'cron' && (
            <div className="scheduled-task-cron">
              <select
                value={CRON_PRESETS.find((p) => p.expr === cronExpr)?.expr ?? ''}
                onChange={(e) => {
                  if (e.target.value) setCronExpr(e.target.value);
                }}
              >
                <option value="">— Presets —</option>
                {CRON_PRESETS.map((p) => (
                  <option key={p.expr} value={p.expr}>
                    {p.label} ({p.expr})
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                placeholder="0 9 * * *"
              />
              <div className="scheduled-task-cron-preview">
                {cronValid ? (
                  <>
                    <strong>Next 5 fires (UTC):</strong>
                    <ul>
                      {cronPreview.map((iso) => (
                        <li key={iso}>{iso}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <span className="approvals-save-error">Invalid cron expression</span>
                )}
              </div>
            </div>
          )}
          {triggerType === 'file-change' && (
            <div className="scheduled-task-cron">
              <input
                type="text"
                value={glob}
                onChange={(e) => setGlob(e.target.value)}
                placeholder="**/*.ts"
              />
              <p className="settings-section-desc">
                Glob matched against files inside the workspace (POSIX-style paths). Heavy dirs (
                <code>node_modules</code>, <code>.git</code>, <code>dist</code>, <code>build</code>)
                and anything ignored by <code>.gitignore</code> or <code>.opencodexignore</code> are
                skipped. Fires after a 500 ms debounce window.
              </p>
            </div>
          )}
          {triggerType === 'git-hook' && (
            <div className="scheduled-task-cron">
              <select
                value={gitHook}
                onChange={(e) => setGitHook(e.target.value as 'post-commit' | 'pre-push')}
              >
                <option value="post-commit">post-commit</option>
                <option value="pre-push">pre-push</option>
              </select>
              <p className="settings-section-desc">
                A wrapper script will be installed into{' '}
                <code>
                  {'<workspace>'}/.git/hooks/{gitHook}
                </code>{' '}
                when this task is saved. Existing user hooks are preserved — see the History panel
                for the inbound URL and an Uninstall button.
              </p>
              {webhookUrl && (
                <div className="scheduled-task-webhook-url">
                  <code>{webhookUrl}</code>
                  <button type="button" className="btn" onClick={copyWebhookUrl}>
                    Copy
                  </button>
                </div>
              )}
            </div>
          )}
          {triggerType === 'webhook' && (
            <div className="scheduled-task-cron">
              <div className="scheduled-task-webhook-secret">
                <input
                  type={webhookSecretRevealed ? 'text' : 'password'}
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder="HMAC shared secret (min 16 chars)"
                />
                <button type="button" className="btn" onClick={generateRandomSecret}>
                  Generate
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setWebhookSecretRevealed((v) => !v)}
                >
                  {webhookSecretRevealed ? 'Hide' : 'Reveal'}
                </button>
              </div>
              <p className="settings-section-desc">
                Compute <code>HMAC-SHA256</code> of the request body using this secret, send it as
                the <code>X-Opencodex-Signature</code> header (hex), and POST JSON to the URL below.
                Rate-limited to 1 request / second / task.
              </p>
              {webhookUrl ? (
                <div className="scheduled-task-webhook-url">
                  <code>{webhookUrl}</code>
                  <button type="button" className="btn" onClick={copyWebhookUrl}>
                    Copy
                  </button>
                </div>
              ) : (
                <p className="settings-section-desc">
                  The inbound URL is available after the task is saved.
                </p>
              )}
            </div>
          )}
        </fieldset>

        <label className="agent-spawn-field">
          <span>Prompt{isLinkedToSkill ? ' (managed by linked skill — read-only)' : ''}</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="What should the agent do when this task fires?"
            disabled={isLinkedToSkill && isEdit}
            readOnly={isLinkedToSkill && isEdit}
          />
        </label>
        {isLinkedToSkill && (
          <p className="settings-section-desc">
            This task is managed by a skill ({linkedSkillId}). Edit the skill&apos;s SKILL.md to
            change the prompt — changes propagate on save.
          </p>
        )}

        {!isExternalRunner && (
          <div className="agent-spawn-row">
            <label className="agent-spawn-field">
              <span>Provider</span>
              <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                {providerOptions.length === 0 ? (
                  <option value="">No configured providers</option>
                ) : (
                  providerOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="agent-spawn-field">
              <span>Model</span>
              <select
                value={effectiveModel}
                onChange={(e) => setModel(e.target.value)}
                disabled={modelOptions.length === 0}
              >
                {modelOptions.length === 0 ? (
                  <option value="">No models available</option>
                ) : (
                  modelOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
        )}

        <label className="agent-spawn-field">
          <span>Runner</span>
          <select value={runnerId} onChange={(e) => setRunnerId(e.target.value)}>
            {runners.length === 0 ? (
              <option value="internal">Built-in (internal)</option>
            ) : (
              runners.map((r) => {
                const sourceBadge = r.source === 'builtin' ? 'built-in' : (r.pluginId ?? 'plugin');
                const status = installState[r.id];
                const disabled = r.source !== 'builtin' && status !== undefined && !status.ok;
                const hint = disabled ? (status?.hint ?? 'Not installed') : undefined;
                return (
                  <option key={r.id} value={r.id} disabled={disabled} title={hint}>
                    {r.displayName} ({sourceBadge}){disabled ? ' — not installed' : ''}
                  </option>
                );
              })
            )}
          </select>
        </label>

        {isExternalRunner && (
          <div className="agent-spawn-runner-note settings-section-desc">
            This runner uses its own provider and tools — OpenCodex approvals do not apply inside
            the harness.
          </div>
        )}

        <label className="agent-spawn-field">
          <span>Workspace</span>
          <div className="agent-spawn-workspace">
            <code>{workspacePath || '(none selected)'}</code>
            <button type="button" onClick={() => void handleBrowseWorkspace()}>
              Change…
            </button>
          </div>
        </label>

        <label className="agent-spawn-toggle">
          <input
            type="checkbox"
            checked={effectiveUseWorktreeSave}
            disabled={isExternalRunner}
            onChange={(e) => setUseWorktree(e.target.checked)}
          />
          <span>
            Use git worktree (recommended — isolates writes for review)
            {isExternalRunner ? ' · forced on for external runners' : ''}
          </span>
        </label>

        <label className="agent-spawn-toggle">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Enabled</span>
        </label>

        <fieldset className="scheduled-task-tools">
          <legend>
            Allowed tools (empty = all)
            {allowedTools.length > 0 && <span> · {allowedTools.length} selected</span>}
          </legend>
          <div className="scheduled-task-tools-grid">
            {tools.length === 0 ? (
              <span className="audit-empty">No tools registered.</span>
            ) : (
              tools.map((t) => (
                <label key={t.name} className="scheduled-task-tool-row">
                  <input
                    type="checkbox"
                    checked={allowedTools.includes(t.name)}
                    onChange={() => toggleTool(t.name)}
                  />
                  <code>{t.name}</code>
                  <span className="scheduled-task-tool-tier">{t.permissionTier}</span>
                </label>
              ))
            )}
          </div>
        </fieldset>

        {error && <p className="approvals-save-error">{error}</p>}

        <div className="approval-modal-actions">
          <div className="approval-modal-action-group">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? 'Saving…' : isEdit ? 'Save' : 'Create'}
            </button>
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
