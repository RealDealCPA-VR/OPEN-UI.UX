import type { ScheduledTask } from '../../shared/scheduled-tasks';
import { describeTrigger, type TriggerType } from '../../shared/triggers';
import { humaneCountdown } from '../views/agent-runs-derive';

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
  manual: 'Manual',
  cron: 'Cron',
  'file-change': 'File',
  'git-hook': 'Git',
  webhook: 'Webhook',
};

export function triggerTypeLabel(type: TriggerType): string {
  return TRIGGER_LABEL[type];
}

function TriggerIcon({ type }: { type: TriggerType }): JSX.Element {
  switch (type) {
    case 'manual':
      return (
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 3.5v3l2 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'cron':
      return (
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M6 3v3.5l1.5 1.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'file-change':
      return (
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <path
            d="M2 1.5h5.5L10 4v6.5H2V1.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M7.5 1.5V4H10" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case 'git-hook':
      return (
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <circle cx="9" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="3" cy="9" r="1.5" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="3" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M3 4.5v3M4.5 3h3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'webhook':
      return (
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <path d="M5 6a1 1 0 1 0 2 0 1 1 0 0 0-2 0Z" fill="currentColor" />
          <path
            d="M2.5 9.5A4.5 4.5 0 0 1 2.5 2.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M9.5 2.5A4.5 4.5 0 0 1 9.5 9.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

/** Format a past ISO/UTC timestamp as a human-readable relative string. */
function formatLastRun(raw: string): string {
  const trimmed = raw.trim();
  const candidate = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T') + 'Z';
  const ms = Date.parse(candidate);
  if (!Number.isFinite(ms)) return raw;
  const diffMs = Date.now() - ms;
  if (diffMs < 0) return raw;
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

/** Capitalise the first letter of a status string. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
              <TriggerIcon type={task.trigger.type} />
              {triggerTypeLabel(task.trigger.type)}
            </span>
            {task.name}
            {!task.enabled && <span className="pill pill-warn">Disabled</span>}
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
                {capitalize(task.lastStatus)}
              </span>
            )}
          </div>
          <div className="scheduled-task-meta">
            <span title={describeTrigger(task.trigger)}>
              <code>{describeTrigger(task.trigger)}</code>
            </span>
            {task.nextRunAt && (
              <span title={`Next run at ${task.nextRunAt} UTC`}>
                Next: {humaneCountdown(task.nextRunAt)}
              </span>
            )}
            {task.lastRunAt && (
              <span title={task.lastRunAt}>Last: {formatLastRun(task.lastRunAt)}</span>
            )}
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`${task.providerId} · ${task.model}`}
            >
              {task.providerId} · {task.model}
            </span>
            {task.useWorktree && <span className="pill">Worktree</span>}
            {task.allowedTools.length > 0 && (
              <span title={task.allowedTools.join(', ')}>Tools: {task.allowedTools.length}</span>
            )}
            {task.linkedSkillId && (
              <span className="pill" title={`managed by skill: ${task.linkedSkillId}`}>
                Skill
              </span>
            )}
          </div>
          {task.description && <p className="scheduled-task-description">{task.description}</p>}
        </div>
        <div className="scheduled-task-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onRunNow(task)}
            disabled={busy}
          >
            {busy ? 'Running…' : 'Run now'}
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
                className="btn btn-danger"
                onClick={() => onUninstallHook(task)}
                disabled={busy}
                title="Remove the wrapper script from .git/hooks/"
              >
                Uninstall hook
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => onDelete(task)}
            disabled={busy}
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}
