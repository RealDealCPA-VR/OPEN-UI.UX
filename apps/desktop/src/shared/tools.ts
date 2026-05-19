import type { PermissionTier } from '@opencodex/core';

export interface ToolListItem {
  name: string;
  description: string;
  permissionTier: PermissionTier;
}
