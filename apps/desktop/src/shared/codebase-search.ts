export type CodebaseSearchMode = 'filename' | 'content' | 'both';

export interface CodebaseSearchRequest {
  workspaceRoot: string;
  query: string;
  mode: CodebaseSearchMode;
  limit?: number;
}

export interface CodebaseSearchHit {
  path: string;
  kind: 'filename' | 'content';
  line?: number;
  snippet?: string;
}

export interface CodebaseSearchResponse {
  hits: CodebaseSearchHit[];
  truncated: boolean;
}

export interface CodebaseReadFileRequest {
  workspaceRoot: string;
  path: string;
  maxBytes?: number;
}

export interface CodebaseReadFileResponse {
  path: string;
  content: string;
  language: string;
  truncated: boolean;
  sizeBytes: number;
}

export interface PendingEditEntry {
  runId: string;
  path: string;
  branch: string;
}

export interface CodebasePendingEditsResponse {
  entries: PendingEditEntry[];
}
