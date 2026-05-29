import { z } from 'zod';

export const pauseRunRequestSchema = z.object({
  runId: z.string().min(1),
});
export type PauseRunRequest = z.infer<typeof pauseRunRequestSchema>;

export const resumeRunRequestSchema = z.object({
  runId: z.string().min(1),
});
export type ResumeRunRequest = z.infer<typeof resumeRunRequestSchema>;

export const pauseRunResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type PauseRunResponse = z.infer<typeof pauseRunResponseSchema>;

export const resumeRunResponseSchema = pauseRunResponseSchema;
export type ResumeRunResponse = z.infer<typeof resumeRunResponseSchema>;

export const worktreePreviewRequestSchema = z.object({
  runId: z.string().min(1),
});
export type WorktreePreviewRequest = z.infer<typeof worktreePreviewRequestSchema>;

export interface WorktreePreviewFile {
  path: string;
  added: number;
  removed: number;
  hunkSnippet: string;
}

export interface WorktreePreviewResponse {
  runId: string;
  worktreePath: string | null;
  largestFile: WorktreePreviewFile | null;
  totalFilesChanged: number;
  error?: string;
}

export type FanoutConsentDecision = 'allow' | 'deny' | 'edit';

export const fanoutConsentRequestSchema = z.object({
  runId: z.string().min(1),
  decision: z.enum(['allow', 'deny', 'edit']),
  editedPlan: z
    .array(
      z.object({
        task: z.string().min(1),
        runnerId: z.string().optional(),
        modelId: z.string().optional(),
      }),
    )
    .optional(),
});
export type FanoutConsentRequest = z.infer<typeof fanoutConsentRequestSchema>;

export const fanoutConsentResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type FanoutConsentResponse = z.infer<typeof fanoutConsentResponseSchema>;

export interface FanoutPlanTask {
  task: string;
  runnerId?: string;
  modelId?: string;
  reason?: string;
}

export interface FanoutConsentRequestedEvent {
  parentRunId: string;
  plan: FanoutPlanTask[];
  requestedAt: number;
  autoAllowDelayMs: number | null;
}

export const fanoutConsentRequestedChannel = 'agent:fanout-consent-requested' as const;
export const runPausedChangedChannel = 'agent:paused-changed' as const;

export interface RunPausedChangedEvent {
  runId: string;
  paused: boolean;
}
