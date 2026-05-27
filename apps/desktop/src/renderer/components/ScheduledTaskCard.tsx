import type { ScheduledTask } from '../../shared/scheduled-tasks';
import { describeTrigger, type TriggerType } from '../../shared/triggers';

export interface ScheduledTaskCardProps {
  task: ScheduledTask;
  busy: boolean;
  onRunNow: (task: ScheduledTask) => void;
  onOpenHistory: (taskId: string) => void;
  onEdit: (task: ScheduledTask) => void;
  onToggleEnabled: (task: ScheduledTask) => void;
  onReinstallHook: (task: ScheduledTask) => void;
  onUninstallHook: (task: ScheduledTask) => void;
  onDelete: (task: ScheduledTask) => void;
}

const TRIGGER_LABEL: Record<TriggerType, string> = {
  manual: 'M',
  cron: 'CRON',
  'file-change': 'FILE',
  'git-hook': 'GIT',
  webhook: 'HOOK',
};

export function triggerTypeLabel(type: TriggerType): string {
  return TRIGGER_LABEL[type];
}

export function ScheduledTaskCard(props: ScheduledTaskCardProps): JSX.Element {
  const {
    task,
    busy,
    onRunNow,
    onOpenHistory,
    onEdit,
    onToggleEnabled,
    onReinstallHook,
    onUninstallHook,
    onDelete,
  } = props;

  return (
    <li className="audit-row scheduled-task-row">
      <div className="scheduled-task-row-head">
        <div className="scheduled-task-row-info">
          <div className="scheduled-task-name">
            <span
              className="trigger-type-badge"
              title={describeTrigger(task.trigger)}
              aria-label={`Trigger type: ${task.trigger.type}`}
            >
              {triggerTypeLabel(task.trigger.type)}
            </span>
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
              <span title={task.allowedTools.join(', ')}>tools: {task.allowedTools.length}</span>
            )}
            {task.linkedSkillId && (
              <span className="pill" title={`managed by skill: ${task.linkedSkillId}`}>
                skill
              </span>
            )}
          </div>
          {task.description && <p className="scheduled-task-description">{task.description}</p>}
        </div>
        <div className="scheduled-task-actions">
          <button type="button" className="btn" onClick={() => onRunNow(task)} disabled={busy}>
            {busy ? '…' : 'Run now'}
          </button>
          <button type="button" className="btn" onClick={() => onOpenHistory(task.id)}>
            History
          </button>
          <button type="button" className="btn" onClick={() => onEdit(task)} disabled={busy}>
            Edit
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onToggleEnabled(task)}
            disabled={busy}
          >
            {task.enabled ? 'Disable' : 'Enable'}
          </button>
          {task.trigger.type === 'git-hook' && (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => onReinstallHook(task)}
                disabled={busy}
                title="Re-install the wrapper script into .git/hooks/"
              >
                Reinstall hook
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onUninstallHook(task)}
                disabled={busy}
                title="Remove the wrapper script from .git/hooks/"
              >
                Uninstall hook
              </button>
            </>
          )}
          <button type="button" className="btn" onClick={() => onDelete(task)} disabled={busy}>
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}
