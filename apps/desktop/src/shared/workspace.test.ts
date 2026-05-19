import { describe, expect, it } from 'vitest';
import {
  applyRemove,
  applySetActive,
  WORKSPACE_HISTORY_LIMIT,
  type WorkspaceState,
} from './workspace';

const empty: WorkspaceState = { active: null, history: [] };

describe('applySetActive', () => {
  it('sets active and prepends to history when empty', () => {
    const next = applySetActive(empty, '/a');
    expect(next).toEqual({ active: '/a', history: ['/a'] });
  });

  it('moves an existing entry to the front (MRU)', () => {
    const state: WorkspaceState = { active: '/c', history: ['/c', '/b', '/a'] };
    const next = applySetActive(state, '/a');
    expect(next).toEqual({ active: '/a', history: ['/a', '/c', '/b'] });
  });

  it('does not duplicate when re-setting the current active', () => {
    const state: WorkspaceState = { active: '/a', history: ['/a', '/b'] };
    const next = applySetActive(state, '/a');
    expect(next).toEqual({ active: '/a', history: ['/a', '/b'] });
  });

  it('caps history at WORKSPACE_HISTORY_LIMIT', () => {
    const history = Array.from({ length: WORKSPACE_HISTORY_LIMIT }, (_, i) => `/p${i}`);
    const state: WorkspaceState = { active: history[0] ?? null, history };
    const next = applySetActive(state, '/new');
    expect(next.history).toHaveLength(WORKSPACE_HISTORY_LIMIT);
    expect(next.history[0]).toBe('/new');
    expect(next.history).not.toContain(`/p${WORKSPACE_HISTORY_LIMIT - 1}`);
  });
});

describe('applyRemove', () => {
  it('drops the path from history', () => {
    const state: WorkspaceState = { active: '/c', history: ['/c', '/b', '/a'] };
    const next = applyRemove(state, '/b');
    expect(next).toEqual({ active: '/c', history: ['/c', '/a'] });
  });

  it('clears active when removing the active path', () => {
    const state: WorkspaceState = { active: '/a', history: ['/a', '/b'] };
    const next = applyRemove(state, '/a');
    expect(next).toEqual({ active: null, history: ['/b'] });
  });

  it('is a no-op for paths not in history', () => {
    const state: WorkspaceState = { active: '/a', history: ['/a', '/b'] };
    const next = applyRemove(state, '/missing');
    expect(next).toEqual({ active: '/a', history: ['/a', '/b'] });
  });
});
