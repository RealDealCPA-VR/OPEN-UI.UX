/**
 * Typed IPC channel contracts shared between main and renderer.
 * Both sides import from here so the wire format stays in sync.
 */

import type { AgentRun, AgentRunsChangedEvent } from './agent-runs';
import type {
  AgentAbortRunRequest,
  AgentAbortRunResponse,
  AgentSpawnFromUiRequest,
  AgentSpawnFromUiResponse,
  GitIsRepoRequest,
  GitIsRepoResponse,
  ShellShowItemRequest,
  ShellShowItemResponse,
} from './agent-spawn';
import type {
  CodebasePendingEditsResponse,
  CodebaseReadFileRequest,
  CodebaseReadFileResponse,
  CodebaseSearchRequest,
  CodebaseSearchResponse,
} from './codebase-search';
import type {
  ApprovalPolicies,
  ApprovalRequest,
  ApprovalResponse,
  FilePreviewRequest,
  FilePreviewResult,
  SetPolicyRequest,
} from './approvals';
import type {
  ChatCancelRequest,
  ChatStartRequest,
  ChatStartResponse,
  ChatStreamEvent,
} from './chat';
import type { PrepareAttachmentsRequest, PrepareAttachmentsResponse } from './attachments';
import type {
  AppendMessageRequest,
  Conversation,
  ConversationUsage,
  ExportConversationRequest,
  ExportConversationResult,
  StoredMessage,
} from './conversation';
import type {
  ProviderDeleteRequest,
  ProviderListItem,
  ProviderSaveRequest,
  ProviderSaveResponse,
  ProviderTestRequest,
  ProviderTestResult,
} from './provider-config';
import type { SelectedModel } from './selected-model';
import type { ShellOutputEvent } from './shell-output';
import type { SetThemeRequest, ThemeChangedEvent, ThemePreference } from './theme';
import type {
  ToolCallAuditPurgeResult,
  ToolCallAuditQuery,
  ToolCallAuditQueryResult,
  ToolCallAuditRetention,
} from './tool-audit';
import type { ToolListItem } from './tools';
import type {
  AddMcpServerRequest,
  McpPromptEntry,
  McpReindexResourcesResult,
  McpResourceEntry,
  McpServerChangedEvent,
  McpServerPreset,
  McpState,
  RemoveMcpServerRequest,
  SetMcpServerEnabledRequest,
} from './mcp';
import type {
  MemoryConfigChangedEvent,
  MemoryStatus,
  SetMemoryConfigRequest,
  SetNotionTokenRequest,
  TestConnectionResult,
  TestMemoryConnectionRequest,
} from './memory';
import type {
  EnablePluginRequest,
  GrantPluginPermissionsRequest,
  InstallPluginRequest,
  PluginListItem,
  PluginPanelDescriptor,
  PluginsChangedEvent,
  UninstallPluginRequest,
} from './plugins';
import type {
  RemoveWorkspaceRequest,
  SetActiveWorkspaceRequest,
  WorkspaceChangedEvent,
  WorkspaceState,
} from './workspace';
import type {
  TelemetryConfig,
  TelemetryConfigChangedEvent,
  TelemetrySetConfigRequest,
} from './telemetry';
import type {
  CrashReportingConfig,
  CrashReportingConfigChangedEvent,
  CrashReportingSetConfigRequest,
} from './crash-reporting';
import type { UpdateStatus, UpdatesCheckResult } from './updates';

export interface IpcInvokeChannels {
  'app:version': {
    request: void;
    response: string;
  };
  'providers:list': {
    request: void;
    response: ProviderListItem[];
  };
  'providers:save': {
    request: ProviderSaveRequest;
    response: ProviderSaveResponse;
  };
  'providers:delete': {
    request: ProviderDeleteRequest;
    response: ProviderListItem;
  };
  'providers:test': {
    request: ProviderTestRequest;
    response: ProviderTestResult;
  };
  'selectedModel:get': {
    request: void;
    response: SelectedModel | null;
  };
  'selectedModel:set': {
    request: SelectedModel | null;
    response: SelectedModel | null;
  };
  'conversations:list': {
    request: void;
    response: Conversation[];
  };
  'conversations:create': {
    request: { title?: string; providerId?: string | null; modelId?: string | null };
    response: Conversation;
  };
  'conversations:rename': {
    request: { id: string; title: string };
    response: Conversation;
  };
  'conversations:delete': {
    request: { id: string };
    response: void;
  };
  'conversations:messages': {
    request: { id: string };
    response: StoredMessage[];
  };
  'conversations:appendMessage': {
    request: AppendMessageRequest;
    response: StoredMessage;
  };
  'conversations:usage': {
    request: { id: string };
    response: ConversationUsage;
  };
  'conversations:export': {
    request: ExportConversationRequest;
    response: ExportConversationResult;
  };
  'chat:start': {
    request: ChatStartRequest;
    response: ChatStartResponse;
  };
  'chat:cancel': {
    request: ChatCancelRequest;
    response: void;
  };
  'attachments:prepare': {
    request: PrepareAttachmentsRequest;
    response: PrepareAttachmentsResponse;
  };
  'approvals:get-policies': {
    request: void;
    response: ApprovalPolicies;
  };
  'approvals:set-policy': {
    request: SetPolicyRequest;
    response: ApprovalPolicies;
  };
  'approvals:respond': {
    request: ApprovalResponse;
    response: void;
  };
  'approvals:read-file-preview': {
    request: FilePreviewRequest;
    response: FilePreviewResult;
  };
  'tools:list': {
    request: void;
    response: ToolListItem[];
  };
  'tool-audit:query': {
    request: ToolCallAuditQuery;
    response: ToolCallAuditQueryResult;
  };
  'tool-audit:get-retention': {
    request: void;
    response: ToolCallAuditRetention;
  };
  'tool-audit:set-retention': {
    request: ToolCallAuditRetention;
    response: ToolCallAuditRetention & ToolCallAuditPurgeResult;
  };
  'tool-audit:clear': {
    request: void;
    response: ToolCallAuditPurgeResult;
  };
  'settings:get-theme': {
    request: void;
    response: ThemePreference;
  };
  'settings:set-theme': {
    request: SetThemeRequest;
    response: ThemePreference;
  };
  'workspace:get': {
    request: void;
    response: WorkspaceState;
  };
  'workspace:set-active': {
    request: SetActiveWorkspaceRequest;
    response: WorkspaceState;
  };
  'workspace:browse': {
    request: void;
    response: WorkspaceState;
  };
  'workspace:remove': {
    request: RemoveWorkspaceRequest;
    response: WorkspaceState;
  };
  'workspace:clear-active': {
    request: void;
    response: WorkspaceState;
  };
  'mcp:list': {
    request: void;
    response: McpState;
  };
  'mcp:add': {
    request: AddMcpServerRequest;
    response: McpState;
  };
  'mcp:remove': {
    request: RemoveMcpServerRequest;
    response: McpState;
  };
  'mcp:set-enabled': {
    request: SetMcpServerEnabledRequest;
    response: McpState;
  };
  'mcp:presets': {
    request: void;
    response: ReadonlyArray<McpServerPreset>;
  };
  'mcp:list-prompts': {
    request: void;
    response: McpPromptEntry[];
  };
  'mcp:list-resources': {
    request: void;
    response: McpResourceEntry[];
  };
  'mcp:reindex-resources': {
    request: void;
    response: McpReindexResourcesResult;
  };
  'onboarding:get-state': {
    request: void;
    response: { complete: boolean };
  };
  'onboarding:set-complete': {
    request: { complete: boolean };
    response: { complete: boolean };
  };
  'plugins:list': {
    request: void;
    response: { plugins: PluginListItem[] };
  };
  'plugins:install-from-path': {
    request: InstallPluginRequest;
    response: { plugins: PluginListItem[] };
  };
  'plugins:browse-and-install': {
    request: void;
    response: { plugins: PluginListItem[]; canceled: boolean };
  };
  'plugins:set-enabled': {
    request: EnablePluginRequest;
    response: { plugins: PluginListItem[] };
  };
  'plugins:grant-permissions': {
    request: GrantPluginPermissionsRequest;
    response: { plugins: PluginListItem[] };
  };
  'plugins:uninstall': {
    request: UninstallPluginRequest;
    response: { plugins: PluginListItem[] };
  };
  'plugins:get-registry-url': {
    request: void;
    response: { url: string | null };
  };
  'plugins:set-registry-url': {
    request: { url: string | null };
    response: { url: string | null };
  };
  'plugins:fetch-registry': {
    request: void;
    response: { entries: unknown[]; error: string | null };
  };
  'plugins:list-panels': {
    request: void;
    response: { panels: PluginPanelDescriptor[] };
  };
  'chat:get-read-only-mode': {
    request: void;
    response: { readOnly: boolean };
  };
  'chat:set-read-only-mode': {
    request: { readOnly: boolean };
    response: { readOnly: boolean };
  };
  'agent:list-runs': {
    request: void;
    response: AgentRun[];
  };
  'agent:clear-runs': {
    request: void;
    response: AgentRun[];
  };
  'agent:get-merge-bundle': {
    request: { runId: string };
    response: {
      runId: string;
      diff: string;
      files: string[];
      branch: string;
    };
  };
  'agent:accept-merge': {
    request: { runId: string };
    response: { ok: boolean; error?: string };
  };
  'agent:reject-merge': {
    request: { runId: string };
    response: { ok: boolean; error?: string };
  };
  'agent:spawn-from-ui': {
    request: AgentSpawnFromUiRequest;
    response: AgentSpawnFromUiResponse;
  };
  'agent:abort-run': {
    request: AgentAbortRunRequest;
    response: AgentAbortRunResponse;
  };
  'codebase:search': {
    request: CodebaseSearchRequest;
    response: CodebaseSearchResponse;
  };
  'codebase:read-file': {
    request: CodebaseReadFileRequest;
    response: CodebaseReadFileResponse;
  };
  'codebase:get-pending-edits': {
    request: void;
    response: CodebasePendingEditsResponse;
  };
  'git:is-repo': {
    request: GitIsRepoRequest;
    response: GitIsRepoResponse;
  };
  'shell:show-item-in-folder': {
    request: ShellShowItemRequest;
    response: ShellShowItemResponse;
  };
  'file-tree:list': {
    request: { path?: string };
    response: {
      entries: Array<{
        name: string;
        path: string;
        isDirectory: boolean;
        hasChildren: boolean;
      }>;
      workspaceRoot: string | null;
    };
  };
  'telemetry:get-config': {
    request: void;
    response: TelemetryConfig;
  };
  'telemetry:set-config': {
    request: TelemetrySetConfigRequest;
    response: TelemetryConfig;
  };
  'crash-reporting:get-config': {
    request: void;
    response: CrashReportingConfig;
  };
  'crash-reporting:set-config': {
    request: CrashReportingSetConfigRequest;
    response: CrashReportingConfig;
  };
  'updates:check': {
    request: void;
    response: UpdatesCheckResult;
  };
  'updates:download': {
    request: void;
    response: void;
  };
  'updates:quit-and-install': {
    request: void;
    response: void;
  };
  'updates:get-status': {
    request: void;
    response: UpdateStatus;
  };
  'updates:set-auto-check': {
    request: { enabled: boolean };
    response: { enabled: boolean };
  };
  'memory:get-status': {
    request: void;
    response: MemoryStatus;
  };
  'memory:set-config': {
    request: SetMemoryConfigRequest;
    response: MemoryStatus;
  };
  'memory:test-connection': {
    request: TestMemoryConnectionRequest;
    response: TestConnectionResult;
  };
  'memory:set-notion-token': {
    request: SetNotionTokenRequest;
    response: MemoryStatus;
  };
  'memory:clear-notion-token': {
    request: void;
    response: MemoryStatus;
  };
  'memory:reload': {
    request: void;
    response: MemoryStatus;
  };
}

export interface IpcEventChannels {
  'app:deep-link': string;
  'chat:event': ChatStreamEvent;
  'chat:approval-request': ApprovalRequest;
  'settings:theme-changed': ThemeChangedEvent;
  'workspace:changed': WorkspaceChangedEvent;
  'mcp:changed': McpServerChangedEvent;
  'plugins:changed': PluginsChangedEvent;
  'chat:read-only-changed': { readOnly: boolean };
  'agent:runs-changed': AgentRunsChangedEvent;
  'shell:output': ShellOutputEvent;
  'telemetry:config-changed': TelemetryConfigChangedEvent;
  'crash-reporting:config-changed': CrashReportingConfigChangedEvent;
  'updates:status-changed': UpdateStatus;
  'memory:config-changed': MemoryConfigChangedEvent;
}

export type IpcInvokeChannel = keyof IpcInvokeChannels;
export type IpcEventChannel = keyof IpcEventChannels;
