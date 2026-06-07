import { z } from 'zod';

export const sourceLocationSchema = z
  .object({
    startLine: z.number().int(),
    endLine: z.number().int(),
  })
  .strict();

export const fileTypeSchema = z.enum(['code', 'document', 'concept']);

export const relationSchema = z.enum(['calls', 'imports_from', 'contains', 'method', 'extends']);

export const confidenceSchema = z.enum(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']);

export const graphNodeSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    file_type: fileTypeSchema,
    source_file: z.string(),
    source_location: sourceLocationSchema.nullish(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const graphEdgeSchema = z
  .object({
    source: z.string().min(1),
    target: z.string().min(1),
    relation: relationSchema,
    confidence: confidenceSchema,
    confidence_score: z.number(),
    source_file: z.string(),
    source_location: sourceLocationSchema.nullish(),
    weight: z.number(),
  })
  .strict();

export const graphJsonSchema = z
  .object({
    nodes: z.array(graphNodeSchema),
    edges: z.array(graphEdgeSchema),
  })
  .strict();

export type SourceLocation = z.infer<typeof sourceLocationSchema>;
export type FileType = z.infer<typeof fileTypeSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type GraphJson = z.infer<typeof graphJsonSchema>;
