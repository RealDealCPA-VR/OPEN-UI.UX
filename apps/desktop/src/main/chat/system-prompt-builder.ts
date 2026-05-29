import { ANTI_SYCOPHANCY_CLAUSE, appendAntiSycophancyClause } from '../agent/anti-sycophancy';
import { getAntiSycophancyEnabled } from '../agent/anti-sycophancy-handlers';
import { getSettings } from '../storage/settings';
import { readLocalMemoryForPrompt } from '../memory/local-fs-backend';

export interface SystemPromptBuildOptions {
  basePrompt?: string;
  workspaceRoot?: string | null;
}

export async function buildChatSystemPrompt(
  opts: SystemPromptBuildOptions = {},
): Promise<string | null> {
  const parts: string[] = [];
  const base = (opts.basePrompt ?? '').trim();
  if (base.length > 0) parts.push(base);

  const localFs = getSettings().memory.backends.localFs;
  if (localFs?.enabled && localFs.prependToSystemPrompt) {
    const workspaceRoot = opts.workspaceRoot ?? getSettings().activeWorkspace;
    if (workspaceRoot && workspaceRoot.trim().length > 0) {
      const memory = await readLocalMemoryForPrompt(workspaceRoot, localFs.maxPrependBytes);
      if (memory.length > 0) {
        parts.push(`<project_memory source=".opencodex/memory.md">\n${memory}\n</project_memory>`);
      }
    }
  }

  let composed = parts.join('\n\n');
  if (getAntiSycophancyEnabled()) {
    composed = appendAntiSycophancyClause(composed, true);
  }
  if (composed.trim().length === 0) return null;
  return composed;
}

export { ANTI_SYCOPHANCY_CLAUSE };
