import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunTriggerSource } from '../../shared/agent-runs';

interface FakeNotificationInstance {
  title: string;
  body: string;
  clickHandlers: Array<() => void>;
  on: (event: string, handler: () => void) => void;
  show: () => void;
}

const notifications: FakeNotificationInstance[] = [];
let notificationSupported = true;
let windowFocused = false;
const sentDeepLinks: string[] = [];

class FakeNotification {
  title: string;
  body: string;
  clickHandlers: Array<() => void> = [];
  constructor(opts: { title: string; body: string; silent?: boolean }) {
    this.title = opts.title;
    this.body = opts.body;
    notifications.push(this as unknown as FakeNotificationInstance);
  }
  static isSupported(): boolean {
    return notificationSupported;
  }
  on(event: string, handler: () => void): void {
    if (event === 'click') this.clickHandlers.push(handler);
  }
  show(): void {}
}

const fakeWindow = {
  isDestroyed: () => false,
  isFocused: () => windowFocused,
  isMinimized: () => false,
  restore: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  webContents: {
    send: (_channel: string, payload: string) => {
      sentDeepLinks.push(payload);
    },
  },
};

vi.mock('electron', () => ({
  Notification: FakeNotification,
  BrowserWindow: {
    getAllWindows: () => [fakeWindow],
  },
}));

vi.mock('../logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let notificationsEnabled = true;
vi.mock('../storage/settings', () => ({
  getAgentRunNotificationsEnabled: () => notificationsEnabled,
}));

const { recordStart, recordComplete, recordError, setMergeStatus, __resetForTests } =
  await import('./run-registry');
const {
  startRunNotifier,
  stopRunNotifier,
  __resetForTests: resetNotifier,
} = await import('./run-notifier');

function completeOk(id: string): void {
  recordComplete(id, {
    text: 'done',
    stopReason: 'end_turn',
    inputTokens: 10,
    outputTokens: 5,
    iterations: 1,
    toolEvents: [],
  });
}

function start(opts: {
  task?: string;
  triggerSource?: AgentRunTriggerSource;
  worktree?: boolean;
}): string {
  return recordStart({
    task: opts.task ?? 'do the thing',
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    triggerSource: opts.triggerSource ?? 'user',
    ...(opts.worktree
      ? {
          worktreePath: '/tmp/wt',
          worktreeBranch: 'feat/x',
          worktreeRepoRoot: '/tmp/repo',
        }
      : {}),
  });
}

beforeEach(() => {
  notifications.length = 0;
  sentDeepLinks.length = 0;
  notificationSupported = true;
  windowFocused = false;
  notificationsEnabled = true;
  __resetForTests();
  resetNotifier();
});

afterEach(() => {
  stopRunNotifier();
  __resetForTests();
});

describe('startRunNotifier', () => {
  it("notifies 'Agent run finished' when a user run completes while blurred", () => {
    startRunNotifier();
    const id = start({ task: 'ship the feature' });
    completeOk(id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.title).toBe('Agent run finished');
    expect(notifications[0]?.body).toBe('ship the feature');
  });

  it("notifies 'Agent run failed' on failure", () => {
    startRunNotifier();
    const id = start({});
    recordError(id, new Error('boom'));
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.title).toBe('Agent run failed');
  });

  it("notifies 'Worktree run ready to review' for a pending-merge worktree run", () => {
    startRunNotifier();
    const id = start({ worktree: true });
    completeOk(id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.title).toBe('Worktree run ready to review');
  });

  it('click focuses the window and emits the deep link', () => {
    startRunNotifier();
    const id = start({});
    completeOk(id);
    expect(notifications).toHaveLength(1);
    for (const handler of notifications[0]!.clickHandlers) handler();
    expect(fakeWindow.focus).toHaveBeenCalled();
    expect(sentDeepLinks).toContain(`opencodex://agent/${id}`);
  });

  it('suppresses notifications when a window is focused', () => {
    windowFocused = true;
    startRunNotifier();
    const id = start({});
    completeOk(id);
    expect(notifications).toHaveLength(0);
  });

  it('never notifies for scheduled runs', () => {
    startRunNotifier();
    const id = start({ triggerSource: 'scheduled' });
    completeOk(id);
    expect(notifications).toHaveLength(0);
  });

  it('does not notify for historical runs hydrated before subscribing', () => {
    const id = start({});
    completeOk(id);
    expect(notifications).toHaveLength(0);
    // Start after the run already exists + completed: seeding suppresses it.
    startRunNotifier();
    setMergeStatus(id, 'pending');
    expect(notifications).toHaveLength(0);
  });

  it('respects the toggle being off', () => {
    notificationsEnabled = false;
    startRunNotifier();
    const id = start({});
    completeOk(id);
    expect(notifications).toHaveLength(0);
  });

  it('does not double-notify when Notification is unsupported', () => {
    notificationSupported = false;
    startRunNotifier();
    const id = start({});
    completeOk(id);
    expect(notifications).toHaveLength(0);
  });
});
