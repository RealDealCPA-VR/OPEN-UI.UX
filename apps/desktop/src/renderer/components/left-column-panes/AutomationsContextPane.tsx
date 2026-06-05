import cronParser from 'cron-parser';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ScheduledTask } from '../../../shared/scheduled-tasks';
import { triggerTypeLabel } from '../ScheduledTaskCard';

export default function AutomationsContextPane(): JSX.Element {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const off = window.opencodex.scheduler.onTasksChanged((payload) => {
      if (!cancelled) setTasks(payload.tasks);
    });
    window.opencodex.scheduler
      .listTasks()
      .then((list) => {
        if (!cancelled) setTasks(list);
      })
      .catch(() => {
        if (!cancelled) setTasks([]);
      });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    const tick = (): void => {
      if (cancelled) return;
      const t = Date.now();
      setNow(t);
      const nextDelay = 1000 - (t % 1000);
      timeoutId = window.setTimeout(tick, nextDelay);
    };
    tick();
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const sorted = useMemo<ScheduledTask[]>(() => {
    if (!tasks) return [];
    const copy = [...tasks];
    copy.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return copy;
  }, [tasks]);

  return (
    <div className="lcc-pane lcc-pane-automations">
      <div className="lcc-pane-head">
        <span className="lcc-pane-title">Automations</span>
      </div>
      {tasks === null ? (
        <ul
          className="lcc-list lcc-list-skeleton"
          aria-busy="true"
          aria-label="Loading automations"
        >
          {[0, 1, 2].map((i) => (
            <li key={i} className="lcc-list-row">
              <div className="lcc-skeleton-row">
                <span className="lcc-skeleton lcc-skeleton-badge" />
                <span className="lcc-skeleton lcc-skeleton-title" />
                <span className="lcc-skeleton lcc-skeleton-meta" />
              </div>
            </li>
          ))}
        </ul>
      ) : sorted.length === 0 ? (
        <div className="lcc-pane-empty-state">
          <p className="lcc-pane-empty">No automations. Create one to run prompts on a schedule.</p>
          <button
            type="button"
            className="btn btn-primary lcc-pane-cta"
            onClick={() => navigate('/automations')}
          >
            Create automation
          </button>
        </div>
      ) : (
        <ul className="lcc-list">
          {sorted.map((task) => (
            <AutomationRow
              key={task.id}
              task={task}
              now={now}
              onSelect={() => navigate(`/automations?taskId=${encodeURIComponent(task.id)}`)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AutomationRow({
  task,
  now,
  onSelect,
}: {
  task: ScheduledTask;
  now: number;
  onSelect: () => void;
}): JSX.Element {
  const countdown = useMemo(() => computeNextRunCountdown(task, now), [task, now]);
  return (
    <li className={`lcc-list-row${task.enabled ? '' : ' dimmed'}`}>
      <button type="button" className="lcc-list-btn" onClick={onSelect}>
        <span className="lcc-list-title">
          <span className="trigger-type-badge" aria-label={`Trigger: ${task.trigger.type}`}>
            {triggerTypeLabel(task.trigger.type)}
          </span>
          {task.name}
        </span>
        <span className="lcc-list-meta">
          {countdown ? (
            <span title="Time until next run" aria-label={'Next run in ' + countdown}>
              in {countdown}
            </span>
          ) : null}
          {!task.enabled ? <span className="pill pill-warn">disabled</span> : null}
        </span>
      </button>
    </li>
  );
}

function computeNextRunCountdown(task: ScheduledTask, now: number): string | null {
  let nextMs: number | null = null;
  if (task.trigger.type === 'cron') {
    try {
      const it = cronParser.parseExpression(task.trigger.expr, { tz: 'UTC' });
      nextMs = it.next().getTime();
    } catch {
      nextMs = null;
    }
  } else if (task.nextRunAt) {
    const parsed = Date.parse(task.nextRunAt);
    if (!Number.isNaN(parsed)) nextMs = parsed;
  }
  if (nextMs === null) return null;
  const diff = Math.max(0, nextMs - now);
  return formatDuration(diff);
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m ${totalSec % 60}s`;
  const totalHr = Math.floor(totalMin / 60);
  if (totalHr < 24) return `${totalHr}h ${totalMin % 60}m`;
  const totalDay = Math.floor(totalHr / 24);
  return `${totalDay}d ${totalHr % 24}h`;
}
