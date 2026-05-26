import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ScheduledTask } from '../../shared/scheduled-tasks';
import type { Skill } from '../../shared/skills';
import { describeTrigger } from '../../shared/triggers';
import { ScheduledTaskEditorModal } from '../components/ScheduledTaskEditorModal';
import { ScheduledTaskRunsDrawer } from '../components/ScheduledTaskRunsDrawer';

export interface PrefillFromSkill {
  name: string;
  description: string;
  prompt: string;
  allowedTools: string[];
  cron: string | null;
  linkedSkillId: string;
}

export function ScheduledTasksPanel(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScheduledTask | 'new' | null>(null);
  const [prefill, setPrefill] = useState<PrefillFromSkill | null>(null);
  const [runsDrawerTaskId, setRunsDrawerTaskId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  // Honor ?prefillSkill=<id> query param — fetch the skill body and open the
  // editor pre-filled. The query param is cleared after the prefill is applied
  // so refreshing the page doesn't reopen the editor.
  useEffect(() => {
    const skillId = searchParams.get('prefillSkill');
    if (!skillId || editing !== null) return;
    void (async () => {
      try {
        const res = await window.opencodex.skills.list();
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
  }, [searchParams, setSearchParams, editing]);

  const toggleEnabled = useCallback(async (task: ScheduledTask) => {
    setBusyId(task.id);
    setActionError(null);
    try {
      await window.opencodex.scheduler.updateTask({
        id: task.id,
        enabled: !task.enabled,
      });
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
      if (!res.ok) {
        setActionError(res.error ?? 'Run failed');
      }
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

  return (
    <div className="scheduled-tasks-panel">
      <div className="scheduled-tasks-toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setEditing('new')}
          disabled={editing !== null}
        >
          + New scheduled task
        </button>
        {actionError && <p className="approvals-save-error">{actionError}</p>}
        {loadError && <p className="approvals-save-error">Failed to load tasks: {loadError}</p>}
      </div>

      {tasks === null ? (
        <p className="audit-empty">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="audit-empty">
          No scheduled tasks yet. Click <strong>New scheduled task</strong> to create one.
        </p>
      ) : (
        <ul className="audit-list">
          {tasks.map((task) => (
            <li key={task.id} className="audit-row scheduled-task-row">
              <div className="scheduled-task-row-head">
                <div className="scheduled-task-row-info">
                  <div className="scheduled-task-name">
                    {task.name}
                    {!task.enabled && <span className="pill pill-warn">disabled</span>}
                    {task.lastStatus && (
                      <span
                        className={
                          task.lastStatus === 'completed'
                            ? 'pill pill-ok'
                            : task.lastStatus === 'failed'
                              ? 'pill pill-warn'
                              : 'pill'
                        }
                      >
                        last: {task.lastStatus}
                      </span>
                    )}
                  </div>
                  <div className="scheduled-task-meta">
                    <span title={describeTrigger(task.trigger)}>
                      <code>{describeTrigger(task.trigger)}</code>
                    </span>
                    {task.nextRunAt && <span>Next: {task.nextRunAt}</span>}
                    {task.lastRunAt && <span>Last: {task.lastRunAt}</span>}
                    <span>
                      {task.providerId} · {task.model}
                    </span>
                    {task.useWorktree && <span className="pill">worktree</span>}
                    {task.allowedTools.length > 0 && (
                      <span title={task.allowedTools.join(', ')}>
                        tools: {task.allowedTools.length}
                      </span>
                    )}
                    {task.linkedSkillId && (
                      <span className="pill" title={`managed by skill: ${task.linkedSkillId}`}>
                        skill
                      </span>
                    )}
                  </div>
                  {task.description && (
                    <p className="scheduled-task-description">{task.description}</p>
                  )}
                </div>
                <div className="scheduled-task-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void runNow(task)}
                    disabled={busyId === task.id}
                  >
                    {busyId === task.id ? '…' : 'Run now'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setRunsDrawerTaskId(task.id)}
                  >
                    History
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setEditing(task)}
                    disabled={busyId === task.id}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void toggleEnabled(task)}
                    disabled={busyId === task.id}
                  >
                    {task.enabled ? 'Disable' : 'Enable'}
                  </button>
                  {task.trigger.type === 'git-hook' && (
                    <>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void reinstallHook(task)}
                        disabled={busyId === task.id}
                        title="Re-install the wrapper script into .git/hooks/"
                      >
                        Reinstall hook
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void uninstallHook(task)}
                        disabled={busyId === task.id}
                        title="Remove the wrapper script from .git/hooks/"
                      >
                        Uninstall hook
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void deleteTask(task)}
                    disabled={busyId === task.id}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
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
    </div>
  );
}
