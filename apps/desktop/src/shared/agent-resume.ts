import { z } from 'zod';

export const agentResumePromptChannel = 'agent:resume-prompt' as const;
export const agentRespondResumeChannel = 'agent:respond-resume' as const;

export const agentResumePromptEventSchema = z.object({
  pending: z.array(
    z.object({
      runId: z.string().min(1),
      task: z.string(),
      providerId: z.string(),
      modelId: z.string(),
      runnerId: z.string(),
      worktreePath: z.string(),
      worktreeBranch: z.string().nullable(),
      worktreeRepoRoot: z.string().nullable(),
      startedAt: z.string(),
    }),
  ),
});

export type AgentResumePromptEvent = z.infer<typeof agentResumePromptEventSchema>;
export type AgentPendingResume = AgentResumePromptEvent['pending'][number];

export const agentResumeDecisionSchema = z.enum(['resume', 'discard']);
export type AgentResumeDecision = z.infer<typeof agentResumeDecisionSchema>;

export const agentRespondResumeRequestSchema = z.object({
  runId: z.string().min(1),
  decision: agentResumeDecisionSchema,
});

export type AgentRespondResumeRequest = z.infer<typeof agentRespondResumeRequestSchema>;

export const agentRespondResumeResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

export type AgentRespondResumeResponse = z.infer<typeof agentRespondResumeResponseSchema>;
