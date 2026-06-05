import type { PermissionTier } from '@opencodex/core';

export type ApprovalPolicy = 'auto' | 'prompt' | 'deny';
export type ApprovalDecision = 'allow' | 'deny';
export type ApprovalScope = 'once' | 'session' | 'always';

export interface ApprovalPolicies {
  tierDefaults: Record<PermissionTier, ApprovalPolicy>;
  toolOverrides: Record<string, ApprovalPolicy>;
}

export interface ApprovalRequest {
  requestId: string;
  streamId: string;
  toolName: string;
  toolDescription: string;
  permissionTier: PermissionTier;
  arguments: unknown;
}

export interface ApprovalOverride {
  toolName: 'write_file';
  arguments: { path: string; content: string };
}

export interface ApprovalResponse {
  requestId: string;
  decision: ApprovalDecision;
  scope: ApprovalScope;
  // Per-hunk partial accept: replaces the original tool with a re-validated
  // write_file of the reconstructed text. Honored ONLY when decision === 'allow'
  // and never cached as session/always policy (once-only semantics).
  override?: ApprovalOverride;
}

export interface SetPolicyRequest {
  scope: 'tier' | 'tool';
  key: string;
  policy: ApprovalPolicy | null;
}

export const DEFAULT_TIER_POLICIES: Record<PermissionTier, ApprovalPolicy> = {
  read: 'auto',
  write: 'prompt',
  execute: 'prompt',
  network: 'prompt',
};

export interface FilePreviewRequest {
  path: string;
}

export interface FilePreviewResult {
  exists: boolean;
  content: string;
  truncated: boolean;
  sizeBytes: number;
}

export const FILE_PREVIEW_MAX_BYTES = 256 * 1024;
