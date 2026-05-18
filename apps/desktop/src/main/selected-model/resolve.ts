import type { ModelCapabilities } from '@opencodex/core';
import type { SelectedModel } from '../../shared/selected-model';
import { getProviderInfo } from '../providers/catalog';

export async function resolveSelectedModel(sel: SelectedModel): Promise<ModelCapabilities | null> {
  const info = await getProviderInfo(sel.providerId);
  if (!info) return null;
  return info.models.find((m) => m.id === sel.modelId) ?? null;
}
