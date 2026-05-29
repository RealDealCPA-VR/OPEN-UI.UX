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
