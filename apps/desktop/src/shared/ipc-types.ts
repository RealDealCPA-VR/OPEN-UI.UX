/**
 * Typed IPC channel contracts shared between main and renderer.
 * Both sides import from here so the wire format stays in sync.
 */

import { z } from 'zod';
import type { AgentRun, AgentRunsChangedEvent } from './agent-runs';
import type {
  AgentRespondResumeRequest,
  AgentRespondResumeResponse,
  AgentResumePromptEvent,
} from './agent-resume';
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
  FanoutConsentRequest,
  FanoutConsentResponse,
  PauseRunRequest,
  PauseRunResponse,
  ResumeRunRequest,
  ResumeRunResponse,
  WorktreePreviewRequest,
  WorktreePreviewResponse,
} from './agent-tree';
import type { AntiSycophancyIpcInvokeChannels } from './anti-sycophancy';
import type {
  Budget,
  BudgetExceededEvent,
  BudgetWarningEvent,
  CreateBudgetRequest,
  DeleteBudgetRequest,
  GetCurrentSpendRequest,
  GetCurrentSpendResponse,
  UpdateBudgetRequest,
} from './budgets';
import type { ConversationSearchRequest, ConversationSearchResponse } from './conversation-search';
import type {
  GitBranchFromConversationRequest,
  GitBranchFromConversationResponse,
  GitCommitHunksRequest,
  GitCommitHunksResponse,
  GitDraftPrRequest,
  GitDraftPrResponse,
  GitOpenPrInBrowserRequest,
  GitOpenPrInBrowserResponse,
  ListConflictsRequest,
  ListConflictsResponse,
  RegenerateHunkRequest,
  RegenerateHunkResponse,
  ResolveConflictRequest,
  ResolveConflictResponse,
} from './git-workflow';
import type {
  McpFetchRegistryResponse,
  McpHealthStatsResponse,
  McpListServerToolsRequest,
  McpListServerToolsResponse,
  McpPermissionsResponse,
  McpRegistryUrlResponse,
  McpRevokePermissionRequest,
  McpRevokePermissionResponse,
  McpRunToolRequest,
  McpRunToolResponse,
  McpSetRegistryUrlRequest,
} from './mcp-registry';
import type { LocalFsMemoryIpcInvokeChannels } from './memory-local-fs';
import type {
  AddAllowlistEntryRequest,
  NetworkPolicy,
  NetworkPolicyChangedEvent,
  RemoveAllowlistEntryRequest,
  SetLocalOnlyModeRequest,
} from './network-policy';
import type {
  OllamaInstallProgress,
  OllamaInstallRequest,
  OllamaInstallResult,
  OllamaListInstallersResponse,
  OllamaProbeResult,
} from './ollama';
import type {
  PairApplyAsContextRequest,
  PairApplyAsContextResponse,
  PairDismissSuggestionRequest,
  PairDismissSuggestionResponse,
  PairGetActiveSuggestionsRequest,
  PairGetActiveSuggestionsResponse,
  PairSetActiveConversationRequest,
  PairSuggestionEvent,
} from './pair';
import type {
  EstimateCostsAcrossProvidersRequest,
  EstimateCostsAcrossProvidersResponse,
  ProviderSwitchChangedEvent,
  SwitchProviderRequest,
  SwitchProviderResponse,
} from './provider-switch';
import type {
  AppliedDiff,
  ExportProvenanceBundleRequest,
  ExportProvenanceBundleResponse,
  GetAppliedDiffRequest,
  ListAppliedDiffsRequest,
  ListAppliedDiffsResponse,
  ProvenanceBundle,
  ReplayConversationRequest,
  ReplayDiffRequest,
  ReplayDiffResult,
  ReplayProgressEvent,
  ReplayResult,
} from './replay';
import type {
  FetchDiffRequest,
  FetchDiffResponse,
  GenerateFindingsRequest,
  GenerateFindingsResponse,
  PostCommentsRequest,
  PostCommentsResponse,
} from './review';
import type {
  CreateRoutingPolicyRequest,
  DeleteRoutingPolicyRequest,
  RoutingChangedEvent,
  RoutingState,
  SetActiveRoutingPolicyRequest,
  UpdateRoutingPolicyRequest,
} from './routing';
import type {
  CheckBinaryResponse,
  DownloadModelRequest,
  DownloadModelResponse,
  DownloadProgressEvent,
  GetVoiceConfigResponse,
  SetBinaryPathRequest,
  SetPttShortcutRequest,
  SetPttShortcutResponse,
  SetSelectedVoiceModelRequest,
  StartRecordingRequest,
  StartRecordingResponse,
  StopRecordingRequest,
  StopRecordingResponse,
  VoicePttEvent,
} from './voice';
import type {
  CreateWorkspaceRequest,
  DeleteWorkspaceRequest,
  LinkWorkspaceRequest,
  ListConversationWorkspacesRequest,
  ListWorkspacesResponse,
  SetPrimaryWorkspaceRequest,
  SetWorkspaceRagEnabledRequest,
  UnlinkWorkspaceRequest,
  WorkspaceEntry,
  WorkspacesChangedEvent,
} from './workspaces';

export type {
  FanoutConsentRequest,
  FanoutConsentRequestedEvent,
  FanoutConsentDecision,
  FanoutConsentResponse,
  FanoutPlanTask,
  PauseRunRequest,
  PauseRunResponse,
  ResumeRunRequest,
  ResumeRunResponse,
  RunPausedChangedEvent,
  WorktreePreviewFile,
  WorktreePreviewRequest,
  WorktreePreviewResponse,
} from './agent-tree';
export { fanoutConsentRequestedChannel, runPausedChangedChannel } from './agent-tree';
export type {
  OllamaInstallProgress,
  OllamaInstallRequest,
  OllamaInstallResult,
  OllamaInstallerKind,
  OllamaListInstallersResponse,
  OllamaModelEntry,
  OllamaProbeResult,
} from './ollama';
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
  AuditWormStatus,
  SetAuditWormEnabledRequest,
  ToolCallAuditExportRequest,
  ToolCallAuditExportResult,
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

export interface IpcInvokeChannelsBase
  extends AntiSycophancyIpcInvokeChannels, LocalFsMemoryIpcInvokeChannels {}

export interface IpcInvokeChannels extends IpcInvokeChannelsBase {
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
    response: { complete: boolean; steps: Record<string, unknown> };
  };
  'onboarding:set-complete': {
    request: { complete: boolean };
    response: { complete: boolean };
  };
  'onboarding:get-step': {
    request: { stepName: string };
    response: { value: unknown };
  };
  'onboarding:set-step': {
    request: { stepName: string; value?: unknown };
    response: { steps: Record<string, unknown> };
  };
  'onboarding:clear-steps': {
    request: void;
    response: { steps: Record<string, unknown> };
  };
  'onboarding:get-defaults': {
    request: void;
    response: { homedir: string };
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
  'plugins:install-from-registry': {
    request: { installUrl: string; acceptUnsigned?: boolean };
    response:
      | { ok: true; plugins: PluginListItem[] }
      | { ok: false; reason: 'unsigned'; pluginName: string }
      | { ok: false; reason: 'error'; error: string };
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
      truncated: boolean;
    };
  };
  'file-tree:has-children': {
    request: { path: string };
    response: { hasChildren: boolean };
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
  // Lane: phase14-tier1-cost-ceiling — budgets
  'budgets:list': {
    request: void;
    response: Budget[];
  };
  'budgets:create': {
    request: CreateBudgetRequest;
    response: Budget;
  };
  'budgets:update': {
    request: UpdateBudgetRequest;
    response: Budget;
  };
  'budgets:delete': {
    request: DeleteBudgetRequest;
    response: { ok: boolean };
  };
  'budgets:get-current-spend': {
    request: GetCurrentSpendRequest;
    response: GetCurrentSpendResponse;
  };
  // Lane 2 — background jobs / resume prompt
  'agent:respond-resume': {
    request: AgentRespondResumeRequest;
    response: AgentRespondResumeResponse;
  };
  // Lane 3 — conversation search
  'conversations:search': {
    request: ConversationSearchRequest;
    response: ConversationSearchResponse;
  };
  // Lane 4 — multi-workspace
  'workspaces:list': {
    request: void;
    response: ListWorkspacesResponse;
  };
  'workspaces:create': {
    request: CreateWorkspaceRequest;
    response: ListWorkspacesResponse;
  };
  'workspaces:delete': {
    request: DeleteWorkspaceRequest;
    response: ListWorkspacesResponse;
  };
  'workspaces:set-primary': {
    request: SetPrimaryWorkspaceRequest;
    response: ListWorkspacesResponse;
  };
  'workspaces:set-rag-enabled': {
    request: SetWorkspaceRagEnabledRequest;
    response: ListWorkspacesResponse;
  };
  'workspaces:link-to-conversation': {
    request: LinkWorkspaceRequest;
    response: { workspaces: WorkspaceEntry[] };
  };
  'workspaces:unlink-from-conversation': {
    request: UnlinkWorkspaceRequest;
    response: { workspaces: WorkspaceEntry[] };
  };
  'workspaces:list-for-conversation': {
    request: ListConversationWorkspacesRequest;
    response: { workspaces: WorkspaceEntry[] };
  };
  // Lane 5 — routing
  'routing:get-state': {
    request: void;
    response: RoutingState;
  };
  'routing:create-policy': {
    request: CreateRoutingPolicyRequest;
    response: RoutingState;
  };
  'routing:update-policy': {
    request: UpdateRoutingPolicyRequest;
    response: RoutingState;
  };
  'routing:delete-policy': {
    request: DeleteRoutingPolicyRequest;
    response: RoutingState;
  };
  'routing:set-active': {
    request: SetActiveRoutingPolicyRequest;
    response: RoutingState;
  };
  // Lane 6 — replay / provenance
  'replay:list-applied-diffs': {
    request: ListAppliedDiffsRequest;
    response: ListAppliedDiffsResponse;
  };
  'replay:get-applied-diff': {
    request: GetAppliedDiffRequest;
    response: AppliedDiff | null;
  };
  'replay:export-provenance-bundle': {
    request: ExportProvenanceBundleRequest;
    response: ExportProvenanceBundleResponse;
  };
  'replay:replay-conversation': {
    request: ReplayConversationRequest;
    response: ReplayResult;
  };
  'replay:replay-diff': {
    request: ReplayDiffRequest;
    response: ReplayDiffResult;
  };
  'replay:get-conversation-bundle': {
    request: { id: string };
    response: { bundle: ProvenanceBundle | null; signature: string | null };
  };
  // Lane 8 — ollama onboarding
  'ollama:probe': {
    request: void;
    response: OllamaProbeResult;
  };
  'ollama:install': {
    request: OllamaInstallRequest;
    response: OllamaInstallResult;
  };
  'ollama:list-installable-managers': {
    request: void;
    response: OllamaListInstallersResponse;
  };
  'settings:get-cloud-provider-tip-shown': {
    request: void;
    response: boolean;
  };
  'settings:set-cloud-provider-tip-shown': {
    request: { value: boolean };
    response: { value: boolean };
  };
  // Lane 9 — git workflow
  'git:branch-from-conversation': {
    request: GitBranchFromConversationRequest;
    response: GitBranchFromConversationResponse;
  };
  'git:commit-hunks': {
    request: GitCommitHunksRequest;
    response: GitCommitHunksResponse;
  };
  'git:draft-pr': {
    request: GitDraftPrRequest;
    response: GitDraftPrResponse;
  };
  'git:open-pr-in-browser': {
    request: GitOpenPrInBrowserRequest;
    response: GitOpenPrInBrowserResponse;
  };
  'git:list-conflicts': {
    request: ListConflictsRequest;
    response: ListConflictsResponse;
  };
  'git:resolve-conflict': {
    request: ResolveConflictRequest;
    response: ResolveConflictResponse;
  };
  'chat:regenerate-hunk': {
    request: RegenerateHunkRequest;
    response: RegenerateHunkResponse;
  };
  // Lane 10 — review
  'review:fetch-diff': {
    request: FetchDiffRequest;
    response: FetchDiffResponse;
  };
  'review:generate-findings': {
    request: GenerateFindingsRequest;
    response: GenerateFindingsResponse;
  };
  'review:post-comments': {
    request: PostCommentsRequest;
    response: PostCommentsResponse;
  };
  // Lane 11 — network policy / privacy
  'network:get-policy': {
    request: void;
    response: NetworkPolicy;
  };
  'network:set-local-only': {
    request: SetLocalOnlyModeRequest;
    response: NetworkPolicy;
  };
  'network:add-allowlist-entry': {
    request: AddAllowlistEntryRequest;
    response: NetworkPolicy;
  };
  'network:remove-allowlist-entry': {
    request: RemoveAllowlistEntryRequest;
    response: NetworkPolicy;
  };
  // Lane 12 — audit export / WORM
  'tool-audit:export-bundle': {
    request: ToolCallAuditExportRequest;
    response: ToolCallAuditExportResult;
  };
  'tool-audit:get-worm': {
    request: void;
    response: AuditWormStatus;
  };
  'tool-audit:set-worm': {
    request: SetAuditWormEnabledRequest;
    response: AuditWormStatus;
  };
  // Lane 13 — voice
  'voice:check-binary': {
    request: void;
    response: CheckBinaryResponse;
  };
  'voice:download-model': {
    request: DownloadModelRequest;
    response: DownloadModelResponse;
  };
  'voice:start-recording': {
    request: StartRecordingRequest;
    response: StartRecordingResponse;
  };
  'voice:stop-recording': {
    request: StopRecordingRequest;
    response: StopRecordingResponse;
  };
  'voice:set-ptt-shortcut': {
    request: SetPttShortcutRequest;
    response: SetPttShortcutResponse;
  };
  'voice:get-config': {
    request: void;
    response: GetVoiceConfigResponse;
  };
  'voice:set-selected-model': {
    request: SetSelectedVoiceModelRequest;
    response: GetVoiceConfigResponse;
  };
  'voice:set-binary-path': {
    request: SetBinaryPathRequest;
    response: GetVoiceConfigResponse;
  };
  // Lane 14 — MCP marketplace / health / permissions
  'mcp:get-registry-url': {
    request: void;
    response: McpRegistryUrlResponse;
  };
  'mcp:set-registry-url': {
    request: McpSetRegistryUrlRequest;
    response: McpRegistryUrlResponse;
  };
  'mcp:fetch-registry': {
    request: void;
    response: McpFetchRegistryResponse;
  };
  'mcp:get-health-stats': {
    request: void;
    response: McpHealthStatsResponse;
  };
  'mcp:get-permissions': {
    request: void;
    response: McpPermissionsResponse;
  };
  'mcp:revoke-permission': {
    request: McpRevokePermissionRequest;
    response: McpRevokePermissionResponse;
  };
  'mcp:run-tool': {
    request: McpRunToolRequest;
    response: McpRunToolResponse;
  };
  'mcp:list-server-tools': {
    request: McpListServerToolsRequest;
    response: McpListServerToolsResponse;
  };
  // Lane 15 — pair suggestions
  'pair:get-active-suggestions': {
    request: PairGetActiveSuggestionsRequest;
    response: PairGetActiveSuggestionsResponse;
  };
  'pair:dismiss-suggestion': {
    request: PairDismissSuggestionRequest;
    response: PairDismissSuggestionResponse;
  };
  'pair:apply-as-context': {
    request: PairApplyAsContextRequest;
    response: PairApplyAsContextResponse;
  };
  'pair:set-active-conversation': {
    request: PairSetActiveConversationRequest;
    response: { ok: boolean };
  };
  // Lane 17 — agent-tree pause/resume/preview/fanout
  'agent:pause-run': {
    request: PauseRunRequest;
    response: PauseRunResponse;
  };
  'agent:resume-run': {
    request: ResumeRunRequest;
    response: ResumeRunResponse;
  };
  'agent:get-worktree-preview': {
    request: WorktreePreviewRequest;
    response: WorktreePreviewResponse;
  };
  'agent:fanout-consent': {
    request: FanoutConsentRequest;
    response: FanoutConsentResponse;
  };
  // Lane 18 — provider switch + cost comparison
  'chat:switch-provider': {
    request: SwitchProviderRequest;
    response: SwitchProviderResponse;
  };
  'chat:estimate-costs-across-providers': {
    request: EstimateCostsAcrossProvidersRequest;
    response: EstimateCostsAcrossProvidersResponse;
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
  // Lane: phase14-tier1-cost-ceiling
  'budget:warning': BudgetWarningEvent;
  'budget:exceeded': BudgetExceededEvent;
  // Lane 2 — background jobs
  'agent:resume-prompt': AgentResumePromptEvent;
  // Lane 4 — multi-workspace
  'workspaces:changed': WorkspacesChangedEvent;
  // Lane 5 — routing
  'routing:changed': RoutingChangedEvent;
  // Lane 6 — replay
  'replay:progress': ReplayProgressEvent;
  // Lane 8 — ollama
  'ollama:install-progress': OllamaInstallProgress;
  // Lane 11 — privacy
  'network:policy-changed': NetworkPolicyChangedEvent;
  // Lane 13 — voice
  'voice:download-progress': DownloadProgressEvent;
  'voice:ptt-event': VoicePttEvent;
  // Lane 15 — pair
  'pair:suggestion': PairSuggestionEvent;
  // Lane 18 — provider switch
  'chat:provider-switched': ProviderSwitchChangedEvent;
}

export type IpcInvokeChannel = keyof IpcInvokeChannels;
export type IpcEventChannel = keyof IpcEventChannels;
