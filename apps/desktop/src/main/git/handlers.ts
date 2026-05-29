import { shell } from 'electron';
import { registerInvoke } from '../ipc/registry';
import {
  chatRegenerateHunkChannel,
  gitBranchFromConversationChannel,
  gitBranchFromConversationRequestSchema,
  gitCommitHunksChannel,
  gitCommitHunksRequestSchema,
  gitDraftPrChannel,
  gitDraftPrRequestSchema,
  gitListConflictsChannel,
  gitOpenPrInBrowserChannel,
  gitOpenPrInBrowserRequestSchema,
  gitResolveConflictChannel,
  listConflictsRequestSchema,
  regenerateHunkRequestSchema,
  resolveConflictRequestSchema,
} from '../../shared/git-workflow';
import { buildProviderForId } from '../chat/provider-builder';
import { regenerateHunk } from '../chat/regenerate-hunk-handler';
import { getConversation, listMessages } from '../storage/conversations';
import { getSettings } from '../storage/settings';
import { getDiffBundle } from '../agent/worktrees';
import { branchFromConversation } from './branch-from-conversation';
import { commitHunks } from './commit-hunks';
import { draftPr, openPrInBrowser } from './draft-pr';
import { listConflicts, resolveConflict } from './merge-conflict-resolver';

/*
 * Submodule limitation
 * --------------------
 * These handlers operate on the top-level repo only. Nested git submodules
 * (`.gitmodules`, `.git` files inside subdirectories pointing to a gitdir)
 * are NOT walked:
 *   - branchFromConversation creates branches in the top-level repo;
 *     submodule HEAD is left detached or untouched.
 *   - commitHunks applies patches to the top-level index; hunks against
 *     paths inside a submodule will be rejected by `git apply --cached`.
 *   - draftPr / openPrInBrowser use the top-level remote.
 *   - merge-conflict-resolver reads only top-level `git status`.
 * Full submodule support — recursive status, per-submodule commits, dual
 * PR flow — is a separate workstream tracked in the audit backlog.
 */

function fetchRecentMessages(
  conversationId: string,
  count: number,
): Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }> {
  try {
    const msgs = listMessages(conversationId);
    const tail = msgs.slice(-count);
    return tail.map((m) => ({ role: m.role, content: m.content }));
  } catch {
    return [];
  }
}

function resolveRepoRoot(): string | null {
  return getSettings().activeWorkspace ?? null;
}

function resolveDefaultProvider(): { providerId: string; modelId: string } | null {
  const settings = getSettings();
  const selected = settings.selectedModel;
  if (selected && selected.providerId && selected.modelId) {
    return { providerId: selected.providerId, modelId: selected.modelId };
  }
  return null;
}

export function registerGitWorkflowHandlers(): void {
  registerInvoke(gitBranchFromConversationChannel, gitBranchFromConversationRequestSchema, (req) =>
    branchFromConversation(req, {
      lookupConversation: (id) => {
        const conv = getConversation(id);
        return conv ? { title: conv.title } : undefined;
      },
      resolveRepoRoot,
    }),
  );

  registerInvoke(gitCommitHunksChannel, gitCommitHunksRequestSchema, (req) => commitHunks(req));

  registerInvoke(gitDraftPrChannel, gitDraftPrRequestSchema, (req) =>
    draftPr(req, {
      buildProvider: buildProviderForId,
      fetchRecentMessages,
      fetchDiff: (repoRoot, _branch, baseRef) => getDiffBundle(repoRoot, baseRef ?? 'HEAD'),
      resolveDefaultProvider,
    }),
  );

  registerInvoke(gitOpenPrInBrowserChannel, gitOpenPrInBrowserRequestSchema, (req) =>
    openPrInBrowser(req, {
      openExternal: (url) => shell.openExternal(url),
    }),
  );

  registerInvoke(gitListConflictsChannel, listConflictsRequestSchema, (req) =>
    listConflicts(req.repoRoot),
  );

  registerInvoke(gitResolveConflictChannel, resolveConflictRequestSchema, (req) =>
    resolveConflict(req),
  );

  registerInvoke(chatRegenerateHunkChannel, regenerateHunkRequestSchema, (req) =>
    regenerateHunk(req, { buildProvider: buildProviderForId }),
  );
}
