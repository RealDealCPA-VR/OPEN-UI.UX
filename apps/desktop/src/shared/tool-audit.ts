export type ToolCallAuditDecision =
  | 'auto'
  | 'prompt-allowed'
  | 'prompt-allowed-session'
  | 'prompt-allowed-always'
  | 'denied';

export type ToolCallAuditTriggerSource = 'user' | 'scheduled';

export type ToolCallAuditErrorFilter = 'any' | 'error' | 'success';

export interface ToolCallAuditRow {
  id: string;
  messageId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  decision: ToolCallAuditDecision;
  isError: boolean;
  durationMs: number | null;
  createdAt: string;
  inputTruncated: boolean;
  outputTruncated: boolean;
  triggerSource: ToolCallAuditTriggerSource;
  runnerId: string | null;
}

export interface ToolCallAuditQueryRow extends ToolCallAuditRow {
  conversationId: string;
  conversationTitle: string;
}

export interface ToolCallAuditQuery {
  toolNames?: readonly string[];
  decisions?: readonly ToolCallAuditDecision[];
  errorState?: ToolCallAuditErrorFilter;
  since?: string | null;
  until?: string | null;
  limit?: number;
  offset?: number;
  filePath?: string;
  runnerIds?: readonly string[];
  triggerSource?: ToolCallAuditTriggerSource;
}

export interface ToolCallAuditExportRequest {
  from?: string | null;
  to?: string | null;
  toolNames?: readonly string[];
  decisions?: readonly ToolCallAuditDecision[];
  errorState?: ToolCallAuditErrorFilter;
  runnerIds?: readonly string[];
  triggerSource?: ToolCallAuditTriggerSource;
  filePath?: string;
}

export interface ToolCallAuditExportResult {
  bundle: {
    format: 'opencodex-audit-v1';
    generatedAt: string;
    deviceId: string;
    publicKey: string;
    entries: ReadonlyArray<unknown>;
  };
  signature: string;
}

export interface AuditWormStatus {
  enabled: boolean;
  path: string | null;
  platformWarning: string | null;
}

export interface SetAuditWormEnabledRequest {
  enabled: boolean;
}

export interface ToolCallAuditFacets {
  toolNames: string[];
  decisions: ToolCallAuditDecision[];
}

export interface ToolCallAuditQueryResult {
  rows: ToolCallAuditQueryRow[];
  total: number;
  facets: ToolCallAuditFacets;
}

export const TOOL_CALL_AUDIT_DECISIONS: readonly ToolCallAuditDecision[] = [
  'auto',
  'prompt-allowed',
  'prompt-allowed-session',
  'prompt-allowed-always',
  'denied',
];

export const TOOL_CALL_AUDIT_PAYLOAD_LIMIT = 4096;

export interface ToolCallAuditRetention {
  retentionDays: number | null;
}

export interface ToolCallAuditPurgeResult {
  deletedCount: number;
}

export const AUDIT_RETENTION_PRESETS: readonly { days: number | null; label: string }[] = [
  { days: null, label: 'Unlimited' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '180 days' },
  { days: 365, label: '365 days' },
];
