import { z } from 'zod';

export const gitBranchFromConversationRequestSchema = z.object({
  conversationId: z.string().min(1),
  repoRoot: z.string().min(1).optional(),
  baseRef: z.string().min(1).optional(),
});

export type GitBranchFromConversationRequest = z.infer<
  typeof gitBranchFromConversationRequestSchema
>;

export interface GitBranchFromConversationResponse {
  ok: boolean;
  branch?: string;
  repoRoot?: string;
  error?: string;
}

export const hunkPatchSchema = z.object({
  filePath: z.string().min(1),
  patch: z.string().min(1),
});

export type HunkPatch = z.infer<typeof hunkPatchSchema>;

export const gitCommitHunksRequestSchema = z.object({
  repoRoot: z.string().min(1),
  message: z.string().min(1),
  hunks: z.array(hunkPatchSchema).min(1),
  signoff: z.boolean().optional(),
});

export type GitCommitHunksRequest = z.infer<typeof gitCommitHunksRequestSchema>;

export interface GitCommitHunksResponse {
  ok: boolean;
  commitSha?: string;
  rejectedFiles?: string[];
  error?: string;
}

export const gitDraftPrRequestSchema = z.object({
  runId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  repoRoot: z.string().min(1),
  branch: z.string().min(1),
  baseBranch: z.string().min(1).optional(),
  diff: z.string().optional(),
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  recentMessageCount: z.number().int().positive().max(50).optional(),
});

export type GitDraftPrRequest = z.infer<typeof gitDraftPrRequestSchema>;

export interface GitDraftPrResponse {
  ok: boolean;
  title?: string;
  body?: string;
  error?: string;
}

export const gitOpenPrInBrowserRequestSchema = z.object({
  repoRoot: z.string().min(1),
  branch: z.string().min(1),
  baseBranch: z.string().min(1).optional(),
  title: z.string().min(1),
  body: z.string(),
});

export type GitOpenPrInBrowserRequest = z.infer<typeof gitOpenPrInBrowserRequestSchema>;

export interface GitOpenPrInBrowserResponse {
  ok: boolean;
  url?: string;
  via?: 'gh' | 'fallback';
  error?: string;
}

export interface MergeConflictHunk {
  index: number;
  filePath: string;
  startLine: number;
  endLine: number;
  ours: string;
  theirs: string;
  base: string | null;
}

export const resolveConflictRequestSchema = z.object({
  repoRoot: z.string().min(1),
  filePath: z.string().min(1),
  hunkIndex: z.number().int().nonnegative(),
  decision: z.enum(['ours', 'theirs', 'both']),
});

export type ResolveConflictRequest = z.infer<typeof resolveConflictRequestSchema>;

export interface ResolveConflictResponse {
  ok: boolean;
  remainingHunks: number;
  error?: string;
}

export const listConflictsRequestSchema = z.object({
  repoRoot: z.string().min(1),
});

export type ListConflictsRequest = z.infer<typeof listConflictsRequestSchema>;

export interface ListConflictsResponse {
  hunks: MergeConflictHunk[];
}

export const regenerateHunkRequestSchema = z.object({
  conversationId: z.string().min(1),
  filePath: z.string().min(1),
  originalSnippet: z.string(),
  modifiedSnippet: z.string(),
  instruction: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  language: z.string().optional(),
});

export type RegenerateHunkRequest = z.infer<typeof regenerateHunkRequestSchema>;

export interface RegenerateHunkResponse {
  ok: boolean;
  suggestion?: string;
  error?: string;
}

export const gitBranchFromConversationChannel = 'git:branch-from-conversation' as const;
export const gitCommitHunksChannel = 'git:commit-hunks' as const;
export const gitDraftPrChannel = 'git:draft-pr' as const;
export const gitOpenPrInBrowserChannel = 'git:open-pr-in-browser' as const;
export const gitListConflictsChannel = 'git:list-conflicts' as const;
export const gitResolveConflictChannel = 'git:resolve-conflict' as const;
export const chatRegenerateHunkChannel = 'chat:regenerate-hunk' as const;

export function slugifyConversationTitle(title: string): string {
  const trimmed = title.trim().toLowerCase();
  if (!trimmed) return 'untitled';
  const ascii = trimmed
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!ascii) return 'untitled';
  return ascii.length > 48 ? ascii.slice(0, 48).replace(/-+$/, '') : ascii;
}
