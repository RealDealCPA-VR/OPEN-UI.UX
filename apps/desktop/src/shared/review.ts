import { z } from 'zod';

export const reviewSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('local-branch'),
    base: z.string().min(1).default('main'),
    head: z.string().min(1).default('HEAD'),
    cwd: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('gh-pr-url'),
    url: z.string().url(),
    cwd: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('github-pr-number'),
    number: z.number().int().positive(),
    cwd: z.string().min(1).optional(),
  }),
]);

export type ReviewSource = z.infer<typeof reviewSourceSchema>;

export const reviewHunkSchema = z.object({
  index: z.number().int().nonnegative(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  newStartLine: z.number().int().positive(),
  newEndLine: z.number().int().positive(),
  header: z.string(),
  content: z.string(),
});

export type ReviewHunk = z.infer<typeof reviewHunkSchema>;

export const reviewFileSchema = z.object({
  path: z.string().min(1),
  oldPath: z.string().nullable(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  language: z.string(),
  hunks: z.array(reviewHunkSchema),
  rawDiff: z.string(),
});

export type ReviewFile = z.infer<typeof reviewFileSchema>;

export const reviewDiffSchema = z.object({
  source: reviewSourceSchema,
  rawDiff: z.string(),
  files: z.array(reviewFileSchema),
  baseRef: z.string().nullable(),
  headRef: z.string().nullable(),
  prNumber: z.number().int().positive().nullable(),
  prUrl: z.string().url().nullable(),
  generatedAt: z.string(),
});

export type ReviewDiff = z.infer<typeof reviewDiffSchema>;

export const reviewSeveritySchema = z.enum(['bug', 'smell', 'style', 'nit']);
export type ReviewSeverity = z.infer<typeof reviewSeveritySchema>;

export const reviewFindingSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  severity: reviewSeveritySchema,
  title: z.string().min(1),
  rationale: z.string().min(1),
  suggestedFix: z.string().nullable(),
  retrievedContext: z.array(z.string()).default([]),
  prompt: z.string().nullable(),
});

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

export const fetchDiffRequestSchema = z.object({
  source: reviewSourceSchema,
});

export type FetchDiffRequest = z.infer<typeof fetchDiffRequestSchema>;

export const fetchDiffResponseSchema = z.object({
  diff: reviewDiffSchema,
});

export type FetchDiffResponse = z.infer<typeof fetchDiffResponseSchema>;

export const generateFindingsRequestSchema = z.object({
  diff: reviewDiffSchema,
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  extraContext: z.string().optional(),
});

export type GenerateFindingsRequest = z.infer<typeof generateFindingsRequestSchema>;

export const generateFindingsResponseSchema = z.object({
  findings: z.array(reviewFindingSchema),
  rawText: z.string(),
  warning: z.string().nullable(),
});

export type GenerateFindingsResponse = z.infer<typeof generateFindingsResponseSchema>;

export const postCommentsRequestSchema = z.object({
  prNumber: z.number().int().positive(),
  cwd: z.string().min(1).optional(),
  findings: z.array(reviewFindingSchema).min(1),
  perFindingMode: z.boolean().default(true),
});

export type PostCommentsRequest = z.infer<typeof postCommentsRequestSchema>;

export const postCommentsResponseSchema = z.object({
  postedCount: z.number().int().nonnegative(),
  errors: z.array(z.object({ findingId: z.string(), message: z.string() })),
});

export type PostCommentsResponse = z.infer<typeof postCommentsResponseSchema>;
