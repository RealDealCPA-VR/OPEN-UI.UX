import { z } from 'zod';

export const checkpointScopeSchema = z.enum(['turn', 'run']);
export type CheckpointScope = z.infer<typeof checkpointScopeSchema>;

export const checkpointKindSchema = z.enum(['content', 'git']);
export type CheckpointKind = z.infer<typeof checkpointKindSchema>;

export const checkpointStatusSchema = z.enum(['active', 'restored', 'superseded']);
export type CheckpointStatus = z.infer<typeof checkpointStatusSchema>;

export const checkpointEntrySchema = z.object({
  id: z.string(),
  checkpointId: z.string(),
  relPath: z.string(),
  preBlobSha: z.string().nullable(),
  preSize: z.number().int().nonnegative(),
  capturedAt: z.string(),
});

export type CheckpointEntry = z.infer<typeof checkpointEntrySchema>;

export const checkpointSchema = z.object({
  id: z.string(),
  scope: checkpointScopeSchema,
  conversationId: z.string().nullable(),
  messageId: z.string().nullable(),
  runId: z.string().nullable(),
  workspaceRoot: z.string(),
  kind: checkpointKindSchema,
  gitBaseSha: z.string().nullable(),
  gitStashRef: z.string().nullable(),
  label: z.string().nullable(),
  status: checkpointStatusSchema,
  totalBytes: z.number().int().nonnegative(),
  createdAt: z.string(),
  restoredAt: z.string().nullable(),
});

export type Checkpoint = z.infer<typeof checkpointSchema>;

export const listCheckpointsForMessageRequestSchema = z.object({
  messageId: z.string().min(1),
});
export type ListCheckpointsForMessageRequest = z.infer<
  typeof listCheckpointsForMessageRequestSchema
>;

export const listCheckpointsForRunRequestSchema = z.object({
  runId: z.string().min(1),
});
export type ListCheckpointsForRunRequest = z.infer<typeof listCheckpointsForRunRequestSchema>;

export interface CheckpointListItem {
  checkpoint: Checkpoint;
  entryCount: number;
}

export interface ListCheckpointsResponse {
  items: CheckpointListItem[];
}

export const restoreCheckpointRequestSchema = z.object({
  checkpointId: z.string().min(1),
});
export type RestoreCheckpointRequest = z.infer<typeof restoreCheckpointRequestSchema>;

export interface RestoreSkippedEntry {
  relPath: string;
  reason: 'path-escape' | 'too-large' | 'error';
}

export interface RestoreCheckpointResponse {
  checkpointId: string;
  newCheckpointId: string | null;
  restoredCount: number;
  deletedCount: number;
  skipped: RestoreSkippedEntry[];
}

export interface CheckpointsChangedEvent {
  scope: CheckpointScope;
  conversationId: string | null;
  messageId: string | null;
  runId: string | null;
}
