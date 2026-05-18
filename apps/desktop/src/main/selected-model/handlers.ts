import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { logger } from '../logger';
import { getSelectedModel, setSelectedModel } from '../storage/settings';
import type { SelectedModel } from '../../shared/selected-model';
import { resolveSelectedModel } from './resolve';

const selectedModelSchema: z.ZodType<SelectedModel> = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
});

const setRequestSchema = selectedModelSchema.nullable();

export function registerSelectedModelHandlers(): void {
  registerInvoke('selectedModel:get', z.void(), () => getSelectedModel());

  registerInvoke('selectedModel:set', setRequestSchema, async (req) => {
    if (req === null) {
      return setSelectedModel(null);
    }
    const match = await resolveSelectedModel(req);
    if (!match) {
      logger.warn({ req }, 'rejected selectedModel:set — unknown provider or model');
      return getSelectedModel();
    }
    return setSelectedModel(req);
  });
}
