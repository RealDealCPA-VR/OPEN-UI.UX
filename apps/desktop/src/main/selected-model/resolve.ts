import type { ModelCapabilities } from '@opencodex/core';
import {
  resolveSelectedModelStore,
  type SelectedModel,
  type SelectedModelResolution,
} from '../../shared/selected-model';
import { getProviderInfo } from '../providers/catalog';
import { getSelectedModelStore } from '../storage/settings';

export async function resolveSelectedModel(sel: SelectedModel): Promise<ModelCapabilities | null> {
  const info = await getProviderInfo(sel.providerId);
  if (!info) return null;
  return info.models.find((m) => m.id === sel.modelId) ?? null;
}

export interface ResolveSelectedModelContext {
  workspacePath?: string | null;
  conversationId?: string | null;
}

/**
 * Returns the SelectedModel that should drive the current call site, applying
 * the workspace > conversation > global precedence defined alongside the
 * SelectedModelStore. Returns the *intent* — callers still need to look up the
 * actual ModelCapabilities via `resolveSelectedModel` and surface the missing-
 * model toast if the picked entry has since vanished from the catalog.
 */
export function resolveSelectedModelByPrecedence(
  ctx: ResolveSelectedModelContext,
): SelectedModelResolution {
  const store = getSelectedModelStore();
  return resolveSelectedModelStore({
    store,
    workspacePath: ctx.workspacePath ?? null,
    conversationId: ctx.conversationId ?? null,
  });
}
