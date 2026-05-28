/**
 * Phase 13 — runner onboarding contract.
 *
 * Shared Zod schemas + inferred types for runner install, auth probe, git-init,
 * and friendly-error surfaces. Lane B (main) and Lane C (renderer) both parse
 * against these at the IPC boundary.
 */

import { z } from 'zod';

export const packageManagerSchema = z.enum(['npm', 'homebrew', 'pipx', 'cargo']);
export type PackageManager = z.infer<typeof packageManagerSchema>;

export const runnerInstallRequestSchema = z.object({
  runnerId: z.string().min(1),
  packageManager: packageManagerSchema,
});
export type RunnerInstallRequest = z.infer<typeof runnerInstallRequestSchema>;

export const runnerInstallProgressSchema = z.object({
  runnerId: z.string().min(1),
  stream: z.enum(['stdout', 'stderr']),
  chunk: z.string(),
});
export type RunnerInstallProgress = z.infer<typeof runnerInstallProgressSchema>;

export const runnerInstallResultSchema = z.object({
  ok: z.boolean(),
  exitCode: z.number().int(),
  durationMs: z.number(),
  stderrTail: z.string().optional(),
});
export type RunnerInstallResult = z.infer<typeof runnerInstallResultSchema>;

export const runnerProbeResultSchema = z.object({
  ok: z.boolean(),
  authenticated: z.boolean(),
  hint: z.string().optional(),
  rawStderr: z.string().optional(),
});
export type RunnerProbeResult = z.infer<typeof runnerProbeResultSchema>;

export const gitInitRequestSchema = z.object({
  workspacePath: z.string().min(1),
  initialCommit: z.boolean().optional(),
});
export type GitInitRequest = z.infer<typeof gitInitRequestSchema>;

export const gitInitResultSchema = z.object({
  ok: z.boolean(),
  branch: z.string().optional(),
  error: z.string().optional(),
});
export type GitInitResult = z.infer<typeof gitInitResultSchema>;

export const runnerFriendlyErrorKindSchema = z.enum([
  'auth',
  'model-not-found',
  'rate-limit',
  'network',
  'unknown',
]);
export type RunnerFriendlyErrorKind = z.infer<typeof runnerFriendlyErrorKindSchema>;

export const runnerFriendlyErrorSchema = z.object({
  runnerId: z.string().min(1),
  kind: runnerFriendlyErrorKindSchema,
  message: z.string(),
  suggestedFix: z.string().optional(),
});
export type RunnerFriendlyError = z.infer<typeof runnerFriendlyErrorSchema>;

export const runnerListPackageManagersResponseSchema = z.object({
  managers: z.array(packageManagerSchema),
});
export type RunnerListPackageManagersResponse = z.infer<
  typeof runnerListPackageManagersResponseSchema
>;

export const runnerProbeAuthRequestSchema = z.object({
  runnerId: z.string().min(1),
});
export type RunnerProbeAuthRequest = z.infer<typeof runnerProbeAuthRequestSchema>;
