import { z } from 'zod';

export const ollamaModelEntrySchema = z.object({
  id: z.string().min(1),
  sizeGb: z.number().nonnegative(),
});
export type OllamaModelEntry = z.infer<typeof ollamaModelEntrySchema>;

export const ollamaProbeResultSchema = z.object({
  running: z.boolean(),
  models: z.array(ollamaModelEntrySchema),
  error: z.string().optional(),
});
export type OllamaProbeResult = z.infer<typeof ollamaProbeResultSchema>;

export const ollamaInstallerKindSchema = z.enum(['homebrew', 'winget', 'script']);
export type OllamaInstallerKind = z.infer<typeof ollamaInstallerKindSchema>;

export const ollamaInstallRequestSchema = z.object({
  installer: ollamaInstallerKindSchema,
});
export type OllamaInstallRequest = z.infer<typeof ollamaInstallRequestSchema>;

export const ollamaInstallResultSchema = z.object({
  ok: z.boolean(),
  exitCode: z.number().int(),
  durationMs: z.number(),
  stderrTail: z.string().optional(),
});
export type OllamaInstallResult = z.infer<typeof ollamaInstallResultSchema>;

export const ollamaListInstallersResponseSchema = z.object({
  installers: z.array(ollamaInstallerKindSchema),
});
export type OllamaListInstallersResponse = z.infer<typeof ollamaListInstallersResponseSchema>;

export const ollamaProbeChannel = 'ollama:probe' as const;
export const ollamaInstallChannel = 'ollama:install' as const;
export const ollamaListInstallersChannel = 'ollama:list-installable-managers' as const;
export const ollamaInstallProgressChannel = 'ollama:install-progress' as const;

export const ollamaInstallProgressSchema = z.object({
  stream: z.enum(['stdout', 'stderr']),
  chunk: z.string(),
});
export type OllamaInstallProgress = z.infer<typeof ollamaInstallProgressSchema>;
