import { z } from 'zod';

export const workspaceEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  displayName: z.string().nullable(),
  isPrimary: z.boolean(),
  ragEnabled: z.boolean(),
  createdAt: z.string(),
});

export type WorkspaceEntry = z.infer<typeof workspaceEntrySchema>;

export const listWorkspacesResponseSchema = z.object({
  workspaces: z.array(workspaceEntrySchema),
});

export type ListWorkspacesResponse = z.infer<typeof listWorkspacesResponseSchema>;

export const createWorkspaceRequestSchema = z.object({
  path: z.string().min(1),
  displayName: z.string().min(1).optional(),
  ragEnabled: z.boolean().optional(),
  setPrimary: z.boolean().optional(),
});

export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const deleteWorkspaceRequestSchema = z.object({
  id: z.string().min(1),
});

export type DeleteWorkspaceRequest = z.infer<typeof deleteWorkspaceRequestSchema>;

export const setPrimaryWorkspaceRequestSchema = z.object({
  id: z.string().min(1),
});

export type SetPrimaryWorkspaceRequest = z.infer<typeof setPrimaryWorkspaceRequestSchema>;

export const setWorkspaceRagEnabledRequestSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});

export type SetWorkspaceRagEnabledRequest = z.infer<typeof setWorkspaceRagEnabledRequestSchema>;

export const linkWorkspaceRequestSchema = z.object({
  conversationId: z.string().min(1),
  workspaceId: z.string().min(1),
});

export type LinkWorkspaceRequest = z.infer<typeof linkWorkspaceRequestSchema>;

export const unlinkWorkspaceRequestSchema = z.object({
  conversationId: z.string().min(1),
  workspaceId: z.string().min(1),
});

export type UnlinkWorkspaceRequest = z.infer<typeof unlinkWorkspaceRequestSchema>;

export const listConversationWorkspacesRequestSchema = z.object({
  conversationId: z.string().min(1),
});

export type ListConversationWorkspacesRequest = z.infer<
  typeof listConversationWorkspacesRequestSchema
>;

export const workspacesChangedEventSchema = z.object({
  workspaces: z.array(workspaceEntrySchema),
});

export type WorkspacesChangedEvent = z.infer<typeof workspacesChangedEventSchema>;

export interface MultiWorkspaceSearchHit {
  workspaceId: string;
  path: string;
  content: string;
  score: number;
  startLine: number;
  endLine: number;
}
