import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScheduledTaskCard } from '../components/ScheduledTaskCard';
import { ScheduledTaskEditorModal } from '../components/ScheduledTaskEditorModal';
import { ScheduledTaskRunsDrawer } from '../components/ScheduledTaskRunsDrawer';
import type { ScheduledTask } from '../../shared/scheduled-tasks';
import type { Skill } from '../../shared/skills';
import type { TriggerType } from '../../shared/triggers';

interface PrefillFromSkill {
  name: string;
  description: string;
  prompt: string;
  allowedTools: string[];
  cron: string | null;
  linkedSkillId: string | null;
}

type TriggerFilter = TriggerType | 'all';

const TRIGGER_FILTER_LABEL: Record<TriggerFilter, string> = {
  all: 'All',
  manual: 'Manual',
  cron: 'Cron',
  'file-change': 'File',
  'git-hook': 'Git',
  webhook: 'Webhook',
};

const TRIGGER_FILTERS: readonly TriggerFilter[] = [
  'all',
  'manual',
  'cron',
  'file-change',
  'git-hook',
  'webhook',
];

interface TemplatePrefill {
  name: string;
  description: string;
  prompt: string;
  cron: string;
}

const TEMPLATES: readonly TemplatePrefill[] = [
  {
    name: 'Daily standup',
    description: 'Summarize git activity from the last 24 hours.',
    prompt:
      'Read the git log for the last 24 hours in this workspace and produce a one-paragraph standup summary covering: what changed, which files were most active, and any TODO comments added.',
    cron: '0 9 * * *',
  },
  {
    name: 'Weekly security audit',
    description: 'Scan the repo for committed secrets and risky patterns.',
    prompt:
      'Scan this repository for committed secrets (API keys, tokens, private keys) and risky patterns (hardcoded credentials, eval of untrusted input, disabled TLS verification). Output a markdown report with file:line references.',
    cron: '0 14 * * 1',
  },
  {
    name: 'Hourly TODO sweep',
    description: 'Grep open TODOs and surface what is stale.',
    prompt:
      'Grep this workspace for TODO, FIXME, and HACK comments. Group by file, count totals, and call out any older than 30 days based on git blame.',
    cron: '0 * * * *',
  },
];

export function AutomationsView(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScheduledTask | 'new' | null>(null);
  const [prefill, setPrefill] = useState<PrefillFromSkill | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all');

  // The runs drawer is URL-driven so deep links like ?taskId=xyz open it directly.
  const runsDrawerTaskId = searchParams.get('taskId');
  const setRunsDrawerTaskId = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set('taskId', id);
      else next.delete('taskId');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    let cancelled = false;
    const off = window.opencodex.scheduler.onTasksChanged((payload) => {
      setTasks(payload.tasks);
    });
    window.opencodex.scheduler
      .listTasks()
      .then((list) => {
        if (!cancelled) setTasks(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    const skillId = searchParams.get('prefillSkill');
    if (!skillId || editing !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.opencodex.skills.list();
        if (cancelled) return;
        const skill: Skill | undefined = res.skills.find((s) => s.id === skillId);
        if (!skill) return;
        setPrefill({
          name: `skill:${skill.name}`,
          description: skill.description,
          prompt: skill.body,
          allowedTools: skill.frontmatter.tools ?? [],
          cron: skill.frontmatter.cron ?? null,
          linkedSkillId: skill.id,
        });
        setEditing('new');
        const next = new URLSearchParams(searchParams);
        next.delete('prefillSkill');
        setSearchParams(next, { replace: true });
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams, editing]);

  const toggleEnabled = useCallback(async (task: ScheduledTask) => {
    setBusyId(task.id);
    setActionError(null);
    try {
      await window.opencodex.scheduler.updateTask({ id: task.id, enabled: !task.enabled });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }, []);

  const runNow = useCallback(async (task: ScheduledTask) => {
    setBusyId(task.id);
    setActionError(null);
    try {
      const res = await window.opencodex.scheduler.runNow(task.id);
      if (!res.ok) setActionError(res.error ?? 'Run failed');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }, []);

  const deleteTask = useCallback(async (task: ScheduledTask) => {
    if (!confirm(`Delete scheduled task "${task.name}"? This cannot be undone.`)) return;
    setBusyId(task.id);
    setActionError(null);
    try {
      await window.opencodex.scheduler.deleteTask(task.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }, []);

  const reinstallHook = useCallback(async (task: ScheduledTask) => {
    setBusyId(task.id);
    setActionError(null);
    try {
      const res = await window.opencodex.scheduler.installGitHook(task.id);
      if (!res.ok) setActionError(res.error ?? 'Hook install failed');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }, []);

  const uninstallHook = useCallback(async (task: ScheduledTask) => {
    if (
      !confirm(
        `Uninstall the git hook installed by "${task.name}"? This task will stop firing on git events until you re-install.`,
      )
    )
      return;
    setBusyId(task.id);
    setActionError(null);
    try {
      const res = await window.opencodex.scheduler.uninstallGitHook(task.id);
      if (!res.ok) setActionError(res.error ?? 'Hook uninstall failed');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }, []);

  const drawerTask = useMemo(
    () =>
      tasks && runsDrawerTaskId ? (tasks.find((t) => t.id === runsDrawerTaskId) ?? null) : null,
    [tasks, runsDrawerTaskId],
  );

  const filteredTasks = useMemo(() => {
    if (!tasks) return null;
    if (triggerFilter === 'all') return tasks;
    return tasks.filter((t) => t.trigger.type === triggerFilter);
  }, [tasks, triggerFilter]);

  const triggerCounts = useMemo(() => {
    const counts: Record<TriggerFilter, number> = {
      all: tasks?.length ?? 0,
      manual: 0,
      cron: 0,
      'file-change': 0,
      'git-hook': 0,
      webhook: 0,
    };
    for (const t of tasks ?? []) counts[t.trigger.type]++;
    return counts;
  }, [tasks]);

  const applyTemplate = (tpl: TemplatePrefill): void => {
    setPrefill({
      name: tpl.name,
      description: tpl.description,
      prompt: tpl.prompt,
      allowedTools: [],
      cron: tpl.cron,
      linkedSkillId: null,
    });
    setEditing('new');
  };

  return (
    <section className="view automations-view">
      <header className="agent-view-header">
        <div>
          <h1>Automations</h1>
          <p>Scheduled tasks, file-change watchers, git hooks, and webhooks.</p>
        </div>
        <div className="agent-view-header-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setEditing('new')}
            disabled={editing !== null}
          >
            + New automation
          </button>
        </div>
      </header>

      {actionError && <p className="approvals-save-error">{actionError}</p>}
      {loadError && <p className="approvals-save-error">Failed to load tasks: {loadError}</p>}

      {tasks !== null && tasks.length > 0 && (
        <div
          role="tablist"
          aria-label="Filter automations by trigger"
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          {TRIGGER_FILTERS.map((f) => {
            const count = triggerCounts[f];
            const active = triggerFilter === f;
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={f !== 'all' && count === 0}
                onClick={() => setTriggerFilter(f)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 999,
                  border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border-strong)'}`,
                  background: active ? 'var(--accent-soft-bg)' : 'transparent',
                  color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
                  fontSize: 12,
                  cursor: f !== 'all' && count === 0 ? 'not-allowed' : 'pointer',
                  opacity: f !== 'all' && count === 0 ? 0.4 : 1,
                }}
              >
                {TRIGGER_FILTER_LABEL[f]} ({count})
              </button>
            );
          })}
        </div>
      )}

      {tasks === null ? (
        <p className="audit-empty">Loading…</p>
      ) : tasks.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: '20px 0',
          }}
        >
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
            No automations yet. Start from a template, or click <strong>New automation</strong> for
            a blank one.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 12,
            }}
          >
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.name}
                type="button"
                onClick={() => applyTemplate(tpl)}
                style={{
                  textAlign: 'left',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 8,
                  padding: '12px 14px',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 13 }}>{tpl.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  {tpl.description}
                </span>
                <span
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: 'var(--text-faint)',
                    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                  }}
                >
                  cron: {tpl.cron}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : filteredTasks && filteredTasks.length === 0 ? (
        <p className="audit-empty">
          No {TRIGGER_FILTER_LABEL[triggerFilter].toLowerCase()} automations.{' '}
          <button
            type="button"
            className="btn"
            onClick={() => setTriggerFilter('all')}
            style={{ marginLeft: 4 }}
          >
            Show all
          </button>
        </p>
      ) : (
        <ul className="audit-list automations-grid">
          {(filteredTasks ?? []).map((task) => (
            <ScheduledTaskCard
              key={task.id}
              task={task}
              busy={busyId === task.id}
              onRunNow={(t) => void runNow(t)}
              onOpenHistory={(id) => setRunsDrawerTaskId(id)}
              onEdit={(t) => setEditing(t)}
              onToggleEnabled={(t) => void toggleEnabled(t)}
              onReinstallHook={(t) => void reinstallHook(t)}
              onUninstallHook={(t) => void uninstallHook(t)}
              onDelete={(t) => void deleteTask(t)}
            />
          ))}
        </ul>
      )}

      {editing && (
        <ScheduledTaskEditorModal
          task={editing === 'new' ? null : editing}
          prefill={editing === 'new' ? prefill : null}
          onClose={() => {
            setEditing(null);
            setPrefill(null);
          }}
          onSaved={() => {
            setEditing(null);
            setPrefill(null);
          }}
        />
      )}

      {drawerTask && (
        <ScheduledTaskRunsDrawer task={drawerTask} onClose={() => setRunsDrawerTaskId(null)} />
      )}
    </section>
  );
}
