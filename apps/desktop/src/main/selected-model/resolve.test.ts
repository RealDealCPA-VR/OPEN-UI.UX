import { describe, expect, it } from 'vitest';
import { catalog, getAllProviderInfo } from '../providers/catalog';
import { resolveSelectedModel } from './resolve';
import {
  DEFAULT_SELECTED_MODEL_STORE,
  resolveSelectedModelStore,
} from '../../shared/selected-model';

describe('resolveSelectedModel', () => {
  it('returns the matching capability for a valid provider + model pair', async () => {
    const infos = await getAllProviderInfo();
    for (const info of infos) {
      const first = info.models[0];
      if (!first) continue;
      const match = await resolveSelectedModel({
        providerId: info.id,
        modelId: first.id,
      });
      expect(match).not.toBeNull();
      expect(match?.id).toBe(first.id);
      expect(match?.providerId).toBe(info.id);
    }
  });

  it('returns null for an unknown provider id', async () => {
    const match = await resolveSelectedModel({
      providerId: 'does-not-exist',
      modelId: 'whatever',
    });
    expect(match).toBeNull();
  });

  it('returns null for a known provider but unknown model id', async () => {
    const first = catalog[0]!;
    const match = await resolveSelectedModel({
      providerId: first.id,
      modelId: 'not-a-real-model-id-zzz',
    });
    expect(match).toBeNull();
  });
});

describe('resolveSelectedModelStore precedence (workspace > conversation > global)', () => {
  const globalSel = { providerId: 'openai', modelId: 'gpt-x' };
  const convSel = { providerId: 'anthropic', modelId: 'claude-y' };
  const wsSel = { providerId: 'ollama', modelId: 'llama-z' };

  it('falls back to global when no scope is set', () => {
    const r = resolveSelectedModelStore({
      store: { ...DEFAULT_SELECTED_MODEL_STORE, global: globalSel },
    });
    expect(r.model).toEqual(globalSel);
    expect(r.scope).toBe('global');
  });

  it('uses conversation override over global when conversation has one', () => {
    const r = resolveSelectedModelStore({
      store: {
        ...DEFAULT_SELECTED_MODEL_STORE,
        global: globalSel,
        byConversation: { 'conv-1': convSel },
      },
      conversationId: 'conv-1',
    });
    expect(r.model).toEqual(convSel);
    expect(r.scope).toBe('conversation');
  });

  it('uses workspace override over both conversation and global', () => {
    const r = resolveSelectedModelStore({
      store: {
        global: globalSel,
        byConversation: { 'conv-1': convSel },
        byWorkspace: { '/repo': wsSel },
      },
      conversationId: 'conv-1',
      workspacePath: '/repo',
    });
    expect(r.model).toEqual(wsSel);
    expect(r.scope).toBe('workspace');
  });

  it('returns null when no scope has anything set', () => {
    const r = resolveSelectedModelStore({ store: DEFAULT_SELECTED_MODEL_STORE });
    expect(r.model).toBeNull();
    expect(r.scope).toBeNull();
  });
});
