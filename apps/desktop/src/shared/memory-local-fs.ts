import { z } from 'zod';

export const localFsAppendRequestSchema = z.object({
  heading: z.string().min(1),
  content: z.string().min(1),
});
export type LocalFsAppendRequest = z.infer<typeof localFsAppendRequestSchema>;

export const localFsSearchRequestSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});
export type LocalFsSearchRequest = z.infer<typeof localFsSearchRequestSchema>;

export interface LocalFsHit {
  id: string;
  heading: string;
  score: number;
  snippet: string;
}

export interface LocalFsAppendResponse {
  path: string;
  bytesWritten: number;
  appendedSection: string;
}

export interface LocalFsReadResponse {
  path: string;
  content: string;
  bytes: number;
}

export interface LocalFsMemoryIpcInvokeChannels {
  'memory-local-fs:read': { request: void; response: LocalFsReadResponse | null };
  'memory-local-fs:search': { request: LocalFsSearchRequest; response: LocalFsHit[] };
  'memory-local-fs:append': { request: LocalFsAppendRequest; response: LocalFsAppendResponse };
}
