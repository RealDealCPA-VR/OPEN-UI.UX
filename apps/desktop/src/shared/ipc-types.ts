/**
 * Typed IPC channel contracts shared between main and renderer.
 * Both sides import from here so the wire format stays in sync.
 */

import { z } from 'zod';
import type { AgentRun, AgentRunsChangedEvent } from './agent-runs';
import type {
  AgentAbortRunRequest,
  AgentAbortRunResponse,
  AgentSpawnFromUiRequest,
  AgentSpawnFromUiResponse,
  GitIsRepoRequest,
  GitIsRepoResponse,
  ShellOpenPathRequest,
  ShellOpenPathResponse,
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
import type {
  CreateScheduledTaskRequest,
  DeleteScheduledTaskRequest,
  GetRunRequest,
  ListRunsRequest,
  ListRunsResponse,
  RunNowRequest,
  RunNowResponse,
  ScheduledRunCompletedEvent,
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTasksChangedEvent,
  UpdateScheduledTaskRequest,
} from './scheduled-tasks';
import type {
  CreateSkillFromTemplateRequest,
  ImportSkillFromUrlRequest,
  OpenSkillInEditorRequest,
  SetSkillEnabledRequest,
  SkillRegistryEntry,
  SkillsChangedEvent,
  SkillsListResponse,
} from './skills';
import type { UiErrorEvent } from './ui-errors';
import type {
  GitInitRequest,
  GitInitResult,
  RunnerFriendlyError,
  RunnerInstallProgress,
  RunnerInstallRequest,
  RunnerInstallResult,
  RunnerListPackageManagersResponse,
  RunnerProbeAuthRequest,
  RunnerProbeResult,
} from './runner-discovery';

export type {
  GitInitRequest,
  GitInitResult,
  PackageManager,
  RunnerFriendlyError,
  RunnerFriendlyErrorKind,
  RunnerInstallProgress,
  RunnerInstallRequest,
  RunnerInstallResult,
  RunnerListPackageManagersResponse,
  RunnerProbeAuthRequest,
  RunnerProbeResult,
} from './runner-discovery';

export const runnerListPackageManagersChannel = 'runner:list-package-managers' as const;
export const runnerInstallChannel = 'runner:install' as const;
export const runnerInstallProgressChannel = 'runner:install-progress' as const;
export const runnerProbeAuthChannel = 'runner:probe-auth' as const;
export const gitInitRepoChannel = 'git:init-repo' as const;
export const runnerFriendlyErrorChannel = 'runner:friendly-error' as const;

export const runnerInstallCheckSchema = z.object({
  ok: z.boolean(),
  version: z.string().optional(),
  hint: z.string().optional(),
});

export const runnerInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  source: z.enum(['builtin', 'plugin']),
  pluginId: z.string().optional(),
  streaming: z.boolean(),
  installed: runnerInstallCheckSchema.optional(),
});

export type RunnerInstallCheck = z.infer<typeof runnerInstallCheckSchema>;
export type RunnerInfo = z.infer<typeof runnerInfoSchema>;

export const checkRunnerInstalledRequestSchema = z.object({
  runnerId: z.string().min(1),
});

export type CheckRunnerInstalledRequest = z.infer<typeof checkRunnerInstalledRequestSchema>;

export const runnersChangedEventSchema = z.object({
  runners: z.array(runnerInfoSchema),
});

export type RunnersChangedEvent = z.infer<typeof runnersChangedEventSchema>;

export const setHoverHintsRequestSchema = z.object({
  enabled: z.boolean(),
});

export type SetHoverHintsRequest = z.infer<typeof setHoverHintsRequestSchema>;

export const getRunnerCliPathRequestSchema = z.object({
  runnerId: z.string().min(1),
});

export type GetRunnerCliPathRequest = z.infer<typeof getRunnerCliPathRequestSchema>;

export const setRunnerCliPathRequestSchema = z.object({
  runnerId: z.string().min(1),
  cliPath: z.string().nullable(),
});

export type SetRunnerCliPathRequest = z.infer<typeof setRunnerCliPathRequestSchema>;

export const hoverHintsChangedEventSchema = z.object({
  enabled: z.boolean(),
});

export type HoverHintsChangedEvent = z.infer<typeof hoverHintsChangedEventSchema>;

export const pluginPresetSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  source: z.string(),
  installHint: z.string().optional(),
});

export type PluginPreset = z.infer<typeof pluginPresetSchema>;

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
  'settings:get-hover-hints': {
    request: void;
    response: boolean;
  };
  'settings:set-hover-hints': {
    request: SetHoverHintsRequest;
    response: void;
  };
  'settings:get-runner-cli-path': {
    request: GetRunnerCliPathRequest;
    response: string | null;
  };
  'settings:set-runner-cli-path': {
    request: SetRunnerCliPathRequest;
    response: void;
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
  'plugins:list-presets': {
    request: void;
    response: PluginPreset[];
  };
  'plugins:install-preset': {
    request: { presetId: string };
    response: { plugins: PluginListItem[] };
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
  'agent:list-runners': {
    request: void;
    response: RunnerInfo[];
  };
  'agent:check-runner-installed': {
    request: CheckRunnerInstalledRequest;
    response: RunnerInstallCheck;
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
  'shell:open-path': {
    request: ShellOpenPathRequest;
    response: ShellOpenPathResponse;
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
  'scheduler:list-tasks': {
    request: void;
    response: ScheduledTask[];
  };
  'scheduler:create-task': {
    request: CreateScheduledTaskRequest;
    response: ScheduledTask;
  };
  'scheduler:update-task': {
    request: UpdateScheduledTaskRequest;
    response: ScheduledTask;
  };
  'scheduler:delete-task': {
    request: DeleteScheduledTaskRequest;
    response: { ok: boolean };
  };
  'scheduler:run-now': {
    request: RunNowRequest;
    response: RunNowResponse;
  };
  'scheduler:list-runs': {
    request: ListRunsRequest;
    response: ListRunsResponse;
  };
  'scheduler:get-run': {
    request: GetRunRequest;
    response: ScheduledTaskRun | null;
  };
  'scheduler:get-trigger-url': {
    request: { taskId: string };
    response: { url: string | null };
  };
  'scheduler:install-git-hook': {
    request: { taskId: string };
    response: { ok: boolean; error?: string };
  };
  'scheduler:uninstall-git-hook': {
    request: { taskId: string };
    response: { ok: boolean; error?: string };
  };
  'scheduler:reinstall-git-hooks': {
    request: void;
    response: { installed: number; errors: string[] };
  };
  'skills:get-registry-url': {
    request: void;
    response: { url: string | null };
  };
  'skills:set-registry-url': {
    request: { url: string | null };
    response: { url: string | null };
  };
  'skills:fetch-registry': {
    request: void;
    response: { entries: SkillRegistryEntry[]; error: string | null };
  };
  'skills:list': {
    request: void;
    response: SkillsListResponse;
  };
  'skills:reload': {
    request: void;
    response: SkillsListResponse;
  };
  'skills:create-from-template': {
    request: CreateSkillFromTemplateRequest;
    response: SkillsListResponse;
  };
  'skills:import-from-url': {
    request: ImportSkillFromUrlRequest;
    response: SkillsListResponse;
  };
  'skills:set-enabled': {
    request: SetSkillEnabledRequest;
    response: SkillsListResponse;
  };
  'skills:open-in-editor': {
    request: OpenSkillInEditorRequest;
    response: { ok: boolean; error?: string };
  };
  'skills:install-starter-pack': {
    request: { names?: string[] };
    response: SkillsListResponse;
  };
  'runner:list-package-managers': {
    request: void;
    response: RunnerListPackageManagersResponse;
  };
  'runner:install': {
    request: RunnerInstallRequest;
    response: RunnerInstallResult;
  };
  'runner:probe-auth': {
    request: RunnerProbeAuthRequest;
    response: RunnerProbeResult;
  };
  'git:init-repo': {
    request: GitInitRequest;
    response: GitInitResult;
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
  'agent:runners-changed': RunnersChangedEvent;
  'settings:hover-hints-changed': HoverHintsChangedEvent;
  'shell:output': ShellOutputEvent;
  'telemetry:config-changed': TelemetryConfigChangedEvent;
  'crash-reporting:config-changed': CrashReportingConfigChangedEvent;
  'updates:status-changed': UpdateStatus;
  'memory:config-changed': MemoryConfigChangedEvent;
  'scheduler:tasks-changed': ScheduledTasksChangedEvent;
  'scheduler:run-completed': ScheduledRunCompletedEvent;
  'skills:changed': SkillsChangedEvent;
  'ui:error': UiErrorEvent;
  'runner:install-progress': RunnerInstallProgress;
  'runner:friendly-error': RunnerFriendlyError;
}

export type IpcInvokeChannel = keyof IpcInvokeChannels;
export type IpcEventChannel = keyof IpcEventChannels;
