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

export interface ApprovalResponse {
  requestId: string;
  decision: ApprovalDecision;
  scope: ApprovalScope;
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
