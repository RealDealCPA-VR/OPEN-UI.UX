import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ScheduledTask } from '../../shared/scheduled-tasks';
import type { Skill } from '../../shared/skills';
import { ScheduledTaskCard } from '../components/ScheduledTaskCard';
import { ScheduledTaskEditorModal } from '../components/ScheduledTaskEditorModal';
import { ScheduledTaskRunsDrawer } from '../components/ScheduledTaskRunsDrawer';

export interface PrefillFromSkill {
  name: string;
  description: string;
  prompt: string;
  allowedTools: string[];
  cron: string | null;
  linkedSkillId: string | null;
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
        if (!skill) {
          setActionError(`Skill "${skillId}" not found — the deep link could not be opened.`);
          return;
        }
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
      } catch (err) {
        setActionError(
          `Could not open the linked skill — ${err instanceof Error ? err.message : String(err)}`,
        );
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
      <div className="settings-block">
        <div className="settings-field-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setEditing('new')}
            disabled={editing !== null}
          >
            + New scheduled task
          </button>
        </div>
        {actionError && (
          <p role="alert" className="field-errors">
            {actionError}
          </p>
        )}
        {loadError && (
          <p role="alert" className="field-errors">
            Failed to load tasks: {loadError}
          </p>
        )}
      </div>

      <div className="settings-block">
        {tasks === null ? (
          <p className="audit-empty">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="audit-empty">
            No scheduled tasks yet. Click <strong>New scheduled task</strong> to create one.
          </p>
        ) : (
          <ul className="audit-list">
            {tasks.map((task) => (
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
      </div>

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
