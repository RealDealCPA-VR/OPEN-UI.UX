export interface SelectedModel {
  providerId: string;
  modelId: string;
}

export type SelectedModelScope = 'global' | 'workspace' | 'conversation';

/**
 * Precedence (highest wins): workspace > conversation > global.
 *
 * - `global` is the user's default model picker in the toolbar.
 * - `conversation` is the model the user pinned to a specific thread (so
 *   continuing an old chat with a discontinued model doesn't silently fall
 *   back to the new default).
 * - `workspace` lets a project (e.g. a strict-no-cloud workspace) override
 *   both — it's the strongest signal because it reflects an environmental
 *   constraint, not a preference.
 */
export interface SelectedModelStore {
  global: SelectedModel | null;
  byConversation: Record<string, SelectedModel>;
  byWorkspace: Record<string, SelectedModel>;
}

export const DEFAULT_SELECTED_MODEL_STORE: SelectedModelStore = {
  global: null,
  byConversation: {},
  byWorkspace: {},
};

export interface SelectedModelResolveInput {
  store: SelectedModelStore;
  workspacePath?: string | null;
  conversationId?: string | null;
}

export interface SelectedModelResolution {
  model: SelectedModel | null;
  scope: SelectedModelScope | null;
}

export function resolveSelectedModelStore(
  input: SelectedModelResolveInput,
): SelectedModelResolution {
  const { store, workspacePath, conversationId } = input;
  if (workspacePath) {
    const ws = store.byWorkspace[workspacePath];
    if (ws) return { model: ws, scope: 'workspace' };
  }
  if (conversationId) {
    const cv = store.byConversation[conversationId];
    if (cv) return { model: cv, scope: 'conversation' };
  }
  if (store.global) return { model: store.global, scope: 'global' };
  return { model: null, scope: null };
}
