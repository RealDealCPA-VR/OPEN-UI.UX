export type CodebaseSearchMode = 'filename' | 'content' | 'both';

export interface CodebaseSearchRequest {
  workspaceRoot: string;
  query: string;
  mode: CodebaseSearchMode;
  limit?: number;
}

export interface CodebaseSearchHit {
  path: string;
  kind: 'filename' | 'content' | 'folder';
  line?: number;
  snippet?: string;
}

export interface CodebaseSearchResponse {
  hits: CodebaseSearchHit[];
  truncated: boolean;
}

export interface CodebaseListDirFilesRequest {
  workspaceRoot: string;
  path: string;
  limit?: number;
}

export interface CodebaseListDirFilesResponse {
  files: string[];
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

export interface GraphNodeView {
  id: string;
  label: string;
  file: string;
  startLine: number | null;
  community: number | null;
  kind: string | null;
  language: string | null;
}

export interface GraphEdgeView {
  source: string;
  target: string;
  relation: string;
}

export interface CodebaseGraphRequest {
  limit?: number;
}

export interface CodebaseGraphResponse {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  available: boolean;
}
