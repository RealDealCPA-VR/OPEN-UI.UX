import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { AgentRun, AgentRunsChangedEvent } from '../shared/agent-runs';
import type {
  AgentRespondResumeResponse,
  AgentResumeDecision,
  AgentResumePromptEvent,
} from '../shared/agent-resume';
import type {
  AgentAbortRunResponse,
  AgentSpawnFromUiRequest,
  AgentSpawnFromUiResponse,
  GitIsRepoResponse,
  ShellOpenPathResponse,
  ShellShowItemResponse,
} from '../shared/agent-spawn';
import type {
  FanoutConsentDecision,
  FanoutConsentRequestedEvent,
  FanoutPlanTask,
  PauseRunResponse,
  ResumeRunResponse,
  RunPausedChangedEvent,
  WorktreePreviewResponse,
} from '../shared/agent-tree';
import { fanoutConsentRequestedChannel, runPausedChangedChannel } from '../shared/agent-tree';
import type {
  Budget,
  BudgetExceededEvent,
  BudgetWarningEvent,
  CreateBudgetRequest,
  DeleteBudgetRequest,
  GetCurrentSpendRequest,
  GetCurrentSpendResponse,
  UpdateBudgetRequest,
} from '../shared/budgets';
import type {
  ConversationSearchRequest,
  ConversationSearchResponse,
  ScrollToMessageEvent,
} from '../shared/conversation-search';
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
} from '../shared/git-workflow';
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
} from '../shared/mcp-registry';
import type {
  AddAllowlistEntryRequest,
  NetworkPolicy,
  NetworkPolicyChangedEvent,
  RemoveAllowlistEntryRequest,
  SetLocalOnlyModeRequest,
} from '../shared/network-policy';
import type {
  OllamaInstallProgress,
  OllamaInstallRequest,
  OllamaInstallResult,
  OllamaListInstallersResponse,
  OllamaProbeResult,
} from '../shared/ollama';
import type {
  PairApplyAsContextRequest,
  PairApplyAsContextResponse,
  PairDismissSuggestionRequest,
  PairDismissSuggestionResponse,
  PairGetActiveSuggestionsRequest,
  PairGetActiveSuggestionsResponse,
  PairSetActiveConversationRequest,
  PairSuggestionEvent,
} from '../shared/pair';
import type {
  EstimateCostsAcrossProvidersRequest,
  EstimateCostsAcrossProvidersResponse,
  ProviderSwitchChangedEvent,
  SwitchProviderRequest,
  SwitchProviderResponse,
} from '../shared/provider-switch';
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
} from '../shared/replay';
import type {
  FetchDiffRequest,
  FetchDiffResponse,
  GenerateFindingsRequest,
  GenerateFindingsResponse,
  PostCommentsRequest,
  PostCommentsResponse,
} from '../shared/review';
import type {
  CreateRoutingPolicyRequest,
  DeleteRoutingPolicyRequest,
  RoutingChangedEvent,
  RoutingState,
  SetActiveRoutingPolicyRequest,
  UpdateRoutingPolicyRequest,
} from '../shared/routing';
import type {
  CheckBinaryResponse,
  DownloadModelResponse,
  DownloadProgressEvent,
  GetVoiceConfigResponse,
  SetPttShortcutResponse,
  StartRecordingResponse,
  StopRecordingResponse,
  VoicePttEvent,
  WhisperModel,
} from '../shared/voice';
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
} from '../shared/workspaces';
import type {
  CodebaseListDirFilesRequest,
  CodebaseListDirFilesResponse,
  CodebasePendingEditsResponse,
  CodebaseReadFileRequest,
  CodebaseReadFileResponse,
  CodebaseSearchRequest,
  CodebaseSearchResponse,
} from '../shared/codebase-search';
import type {
  ApprovalPolicies,
  ApprovalRequest,
  ApprovalResponse,
  FilePreviewRequest,
  FilePreviewResult,
  SetPolicyRequest,
} from '../shared/approvals';
import type {
  ChatCancelRequest,
  ChatListActiveResponse,
  ChatReattachRequest,
  ChatReattachResponse,
  ChatStartRequest,
  ChatStartResponse,
  ChatStreamEvent,
} from '../shared/chat';
import type {
  CheckpointsChangedEvent,
  ListCheckpointsForMessageRequest,
  ListCheckpointsForRunRequest,
  ListCheckpointsResponse,
  RestoreCheckpointRequest,
  RestoreCheckpointResponse,
} from '../shared/checkpoints';
import type { PrepareAttachmentsRequest, PrepareAttachmentsResponse } from '../shared/attachments';
import type {
  AppendMessageRequest,
  Conversation,
  ConversationUsage,
  ExportConversationRequest,
  ExportConversationResult,
  StoredMessage,
} from '../shared/conversation';
import type {
  ProviderDeleteRequest,
  ProviderListItem,
  ProviderSaveRequest,
  ProviderSaveResponse,
  ProviderTestRequest,
  ProviderTestResult,
} from '../shared/provider-config';
import type { SelectedModel } from '../shared/selected-model';
import type { ShellOutputEvent } from '../shared/shell-output';
import {
  parseInitialThemeArg,
  resolveEffectiveTheme,
  type SetThemeRequest,
  type ThemeChangedEvent,
  type ThemePreference,
} from '../shared/theme';
import type {
  AuditWormStatus,
  SetAuditWormEnabledRequest,
  ToolCallAuditExportRequest,
  ToolCallAuditExportResult,
  ToolCallAuditPurgeResult,
  ToolCallAuditQuery,
  ToolCallAuditQueryResult,
  ToolCallAuditRetention,
} from '../shared/tool-audit';
import type { ToolListItem } from '../shared/tools';
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
} from '../shared/mcp';
import type {
  EnablePluginRequest,
  GrantPluginPermissionsRequest,
  InstallPluginRequest,
  PluginListItem,
  PluginPanelDescriptor,
  PluginsChangedEvent,
  UninstallPluginRequest,
} from '../shared/plugins';
import type {
  RemoveWorkspaceRequest,
  SetActiveWorkspaceRequest,
  WorkspaceChangedEvent,
  WorkspaceState,
} from '../shared/workspace';
import type {
  TelemetryConfig,
  TelemetryConfigChangedEvent,
  TelemetrySetConfigRequest,
} from '../shared/telemetry';
import type {
  CrashReportingConfig,
  CrashReportingConfigChangedEvent,
  CrashReportingSetConfigRequest,
} from '../shared/crash-reporting';
import type { UpdateStatus, UpdatesCheckResult } from '../shared/updates';
import type {
  MemoryBackendId,
  MemoryConfig,
  MemoryConfigChangedEvent,
  MemoryStatus,
  TestConnectionResult,
} from '../shared/memory';
import type {
  CreateScheduledTaskRequest,
  ListRunsRequest,
  ListRunsResponse,
  RunNowResponse,
  ScheduledRunCompletedEvent,
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTasksChangedEvent,
  UpdateScheduledTaskRequest,
} from '../shared/scheduled-tasks';
import type {
  CreateSkillFromTemplateRequest,
  ImportSkillFromUrlRequest,
  OpenSkillInEditorRequest,
  SetSkillEnabledRequest,
  SkillRegistryEntry,
  SkillsChangedEvent,
  SkillsListResponse,
} from '../shared/skills';
import type {
  AgentRunNotificationsChangedEvent,
  HoverHintsChangedEvent,
  PluginPreset,
  RunnerInfo,
  RunnerInstallCheck,
  RunnersChangedEvent,
} from '../shared/ipc-types';
import type {
  GitInitRequest,
  GitInitResult,
  PackageManager,
  RunnerFriendlyError,
  RunnerInstallProgress,
  RunnerInstallRequest,
  RunnerInstallResult,
  RunnerProbeResult,
} from '../shared/runner-discovery';
import type { UiErrorEvent } from '../shared/ui-errors';

type DeepLinkListener = (url: string) => void;
type ChatEventListener = (payload: ChatStreamEvent) => void;
type ShellOutputListener = (payload: ShellOutputEvent) => void;
type ApprovalRequestListener = (req: ApprovalRequest) => void;
type ThemeChangedListener = (payload: ThemeChangedEvent) => void;
type WorkspaceChangedListener = (payload: WorkspaceChangedEvent) => void;
type McpChangedListener = (payload: McpServerChangedEvent) => void;
type PluginsChangedListener = (payload: PluginsChangedEvent) => void;

const initialThemePreference = parseInitialThemeArg(process.argv);

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

function applyEffectiveTheme(preference: ThemePreference): void {
  const effective = resolveEffectiveTheme(preference, systemPrefersDark());
  try {
    document.documentElement.setAttribute('data-theme', effective);
  } catch {
    // document may not yet be available in extremely early preload phases
  }
}

applyEffectiveTheme(initialThemePreference);

const providers = {
  list: (): Promise<ProviderListItem[]> => ipcRenderer.invoke('providers:list'),
  save: (req: ProviderSaveRequest): Promise<ProviderSaveResponse> =>
    ipcRenderer.invoke('providers:save', req),
  delete: (req: ProviderDeleteRequest): Promise<ProviderListItem> =>
    ipcRenderer.invoke('providers:delete', req),
  test: (req: ProviderTestRequest): Promise<ProviderTestResult> =>
    ipcRenderer.invoke('providers:test', req),
};

const selectedModel = {
  get: (): Promise<SelectedModel | null> => ipcRenderer.invoke('selectedModel:get'),
  set: (sel: SelectedModel | null): Promise<SelectedModel | null> =>
    ipcRenderer.invoke('selectedModel:set', sel),
};

const conversations = {
  list: (): Promise<Conversation[]> => ipcRenderer.invoke('conversations:list'),
  create: (req: {
    title?: string;
    providerId?: string | null;
    modelId?: string | null;
  }): Promise<Conversation> => ipcRenderer.invoke('conversations:create', req),
  rename: (req: { id: string; title: string }): Promise<Conversation> =>
    ipcRenderer.invoke('conversations:rename', req),
  delete: (req: { id: string }): Promise<void> => ipcRenderer.invoke('conversations:delete', req),
  messages: (req: { id: string }): Promise<StoredMessage[]> =>
    ipcRenderer.invoke('conversations:messages', req),
  appendMessage: (req: AppendMessageRequest): Promise<StoredMessage> =>
    ipcRenderer.invoke('conversations:appendMessage', req),
  usage: (req: { id: string }): Promise<ConversationUsage> =>
    ipcRenderer.invoke('conversations:usage', req),
  export: (req: ExportConversationRequest): Promise<ExportConversationResult> =>
    ipcRenderer.invoke('conversations:export', req),
  // Lane 3 — FTS search across conversations
  search: (req: ConversationSearchRequest): Promise<ConversationSearchResponse> =>
    ipcRenderer.invoke('conversations:search', req),
  onScrollToMessage: (listener: (payload: ScrollToMessageEvent) => void): (() => void) => {
    const wrapped = (event: Event): void => {
      const ce = event as CustomEvent<ScrollToMessageEvent>;
      if (ce.detail) listener(ce.detail);
    };
    window.addEventListener('conversation:scroll-to-message', wrapped);
    return () => window.removeEventListener('conversation:scroll-to-message', wrapped);
  },
};

type ReadOnlyChangedListener = (payload: { readOnly: boolean }) => void;

const chat = {
  start: (req: ChatStartRequest): Promise<ChatStartResponse> =>
    ipcRenderer.invoke('chat:start', req),
  cancel: (req: ChatCancelRequest): Promise<void> => ipcRenderer.invoke('chat:cancel', req),
  // Crash-restore — reattach reuses the existing chat:event subscription below.
  listActive: (): Promise<ChatListActiveResponse> => ipcRenderer.invoke('chat:list-active'),
  reattach: (req: ChatReattachRequest): Promise<ChatReattachResponse> =>
    ipcRenderer.invoke('chat:reattach', req),
  onEvent: (listener: ChatEventListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: ChatStreamEvent): void => listener(payload);
    ipcRenderer.on('chat:event', wrapped);
    return () => ipcRenderer.off('chat:event', wrapped);
  },
  getReadOnlyMode: (): Promise<{ readOnly: boolean }> =>
    ipcRenderer.invoke('chat:get-read-only-mode'),
  setReadOnlyMode: (readOnly: boolean): Promise<{ readOnly: boolean }> =>
    ipcRenderer.invoke('chat:set-read-only-mode', { readOnly }),
  onReadOnlyChanged: (listener: ReadOnlyChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: { readOnly: boolean }): void =>
      listener(payload);
    ipcRenderer.on('chat:read-only-changed', wrapped);
    return () => ipcRenderer.off('chat:read-only-changed', wrapped);
  },
  onShellOutput: (listener: ShellOutputListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: ShellOutputEvent): void =>
      listener(payload);
    ipcRenderer.on('shell:output', wrapped);
    return () => ipcRenderer.off('shell:output', wrapped);
  },
  // Lane 9 — regenerate a hunk via chat
  regenerateHunk: (req: RegenerateHunkRequest): Promise<RegenerateHunkResponse> =>
    ipcRenderer.invoke('chat:regenerate-hunk', req),
  // Lane 18 — switch provider mid-conversation + cross-provider cost estimate
  switchProvider: (req: SwitchProviderRequest): Promise<SwitchProviderResponse> =>
    ipcRenderer.invoke('chat:switch-provider', req),
  estimateCostsAcrossProviders: (
    req: EstimateCostsAcrossProvidersRequest,
  ): Promise<EstimateCostsAcrossProvidersResponse> =>
    ipcRenderer.invoke('chat:estimate-costs-across-providers', req),
  onProviderSwitched: (listener: (payload: ProviderSwitchChangedEvent) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: ProviderSwitchChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('chat:provider-switched', wrapped);
    return () => ipcRenderer.off('chat:provider-switched', wrapped);
  },
};

const attachments = {
  prepare: (req: PrepareAttachmentsRequest): Promise<PrepareAttachmentsResponse> =>
    ipcRenderer.invoke('attachments:prepare', req),
};

const approvals = {
  getPolicies: (): Promise<ApprovalPolicies> => ipcRenderer.invoke('approvals:get-policies'),
  setPolicy: (req: SetPolicyRequest): Promise<ApprovalPolicies> =>
    ipcRenderer.invoke('approvals:set-policy', req),
  respond: (res: ApprovalResponse): Promise<void> => ipcRenderer.invoke('approvals:respond', res),
  readFilePreview: (req: FilePreviewRequest): Promise<FilePreviewResult> =>
    ipcRenderer.invoke('approvals:read-file-preview', req),
  onRequest: (listener: ApprovalRequestListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: ApprovalRequest): void => listener(payload);
    ipcRenderer.on('chat:approval-request', wrapped);
    return () => ipcRenderer.off('chat:approval-request', wrapped);
  },
};

const tools = {
  list: (): Promise<ToolListItem[]> => ipcRenderer.invoke('tools:list'),
};

const toolAudit = {
  query: (req: ToolCallAuditQuery): Promise<ToolCallAuditQueryResult> =>
    ipcRenderer.invoke('tool-audit:query', req),
  getRetention: (): Promise<ToolCallAuditRetention> =>
    ipcRenderer.invoke('tool-audit:get-retention'),
  setRetention: (
    req: ToolCallAuditRetention,
  ): Promise<ToolCallAuditRetention & ToolCallAuditPurgeResult> =>
    ipcRenderer.invoke('tool-audit:set-retention', req),
  clear: (): Promise<ToolCallAuditPurgeResult> => ipcRenderer.invoke('tool-audit:clear'),
  // Lane 12 — export-bundle / WORM
  exportBundle: (req: ToolCallAuditExportRequest): Promise<ToolCallAuditExportResult> =>
    ipcRenderer.invoke('tool-audit:export-bundle', req),
  getWormStatus: (): Promise<AuditWormStatus> => ipcRenderer.invoke('tool-audit:get-worm'),
  setWormEnabled: (req: SetAuditWormEnabledRequest): Promise<AuditWormStatus> =>
    ipcRenderer.invoke('tool-audit:set-worm', req),
};

const theme = {
  getInitialPreference: (): ThemePreference => initialThemePreference,
  get: (): Promise<ThemePreference> => ipcRenderer.invoke('settings:get-theme'),
  set: (req: SetThemeRequest): Promise<ThemePreference> =>
    ipcRenderer.invoke('settings:set-theme', req),
  onChanged: (listener: ThemeChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: ThemeChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('settings:theme-changed', wrapped);
    return () => ipcRenderer.off('settings:theme-changed', wrapped);
  },
};

type HoverHintsChangedListener = (enabled: boolean) => void;
type AgentRunNotificationsChangedListener = (enabled: boolean) => void;

const settings = {
  getHoverHintsEnabled: (): Promise<boolean> => ipcRenderer.invoke('settings:get-hover-hints'),
  setHoverHintsEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:set-hover-hints', { enabled }),
  onHoverHintsChanged: (listener: HoverHintsChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: HoverHintsChangedEvent): void =>
      listener(payload.enabled);
    ipcRenderer.on('settings:hover-hints-changed', wrapped);
    return () => ipcRenderer.off('settings:hover-hints-changed', wrapped);
  },
  getAgentRunNotificationsEnabled: (): Promise<boolean> =>
    ipcRenderer.invoke('settings:get-agent-run-notifications'),
  setAgentRunNotificationsEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:set-agent-run-notifications', { enabled }),
  onAgentRunNotificationsChanged: (
    listener: AgentRunNotificationsChangedListener,
  ): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: AgentRunNotificationsChangedEvent): void =>
      listener(payload.enabled);
    ipcRenderer.on('settings:agent-run-notifications-changed', wrapped);
    return () => ipcRenderer.off('settings:agent-run-notifications-changed', wrapped);
  },
  getRunnerCliPath: (runnerId: string): Promise<string | null> =>
    ipcRenderer.invoke('settings:get-runner-cli-path', { runnerId }),
  setRunnerCliPath: (runnerId: string, cliPath: string | null): Promise<void> =>
    ipcRenderer.invoke('settings:set-runner-cli-path', { runnerId, cliPath }),
  // Lane 8 — cloud provider tip dismissal
  getCloudProviderTipShown: (): Promise<boolean> =>
    ipcRenderer.invoke('settings:get-cloud-provider-tip-shown'),
  setCloudProviderTipShown: (value: boolean): Promise<{ value: boolean }> =>
    ipcRenderer.invoke('settings:set-cloud-provider-tip-shown', { value }),
};

const workspace = {
  get: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:get'),
  setActive: (req: SetActiveWorkspaceRequest): Promise<WorkspaceState> =>
    ipcRenderer.invoke('workspace:set-active', req),
  browse: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:browse'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('workspace:pick-folder'),
  remove: (req: RemoveWorkspaceRequest): Promise<WorkspaceState> =>
    ipcRenderer.invoke('workspace:remove', req),
  clearActive: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:clear-active'),
  onChanged: (listener: WorkspaceChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: WorkspaceChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('workspace:changed', wrapped);
    return () => ipcRenderer.off('workspace:changed', wrapped);
  },
};

const mcp = {
  list: (): Promise<McpState> => ipcRenderer.invoke('mcp:list'),
  add: (req: AddMcpServerRequest): Promise<McpState> => ipcRenderer.invoke('mcp:add', req),
  remove: (req: RemoveMcpServerRequest): Promise<McpState> => ipcRenderer.invoke('mcp:remove', req),
  setEnabled: (req: SetMcpServerEnabledRequest): Promise<McpState> =>
    ipcRenderer.invoke('mcp:set-enabled', req),
  presets: (): Promise<ReadonlyArray<McpServerPreset>> => ipcRenderer.invoke('mcp:presets'),
  listPrompts: (): Promise<McpPromptEntry[]> => ipcRenderer.invoke('mcp:list-prompts'),
  listResources: (): Promise<McpResourceEntry[]> => ipcRenderer.invoke('mcp:list-resources'),
  reindexResources: (): Promise<McpReindexResourcesResult> =>
    ipcRenderer.invoke('mcp:reindex-resources'),
  onChanged: (listener: McpChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: McpServerChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('mcp:changed', wrapped);
    return () => ipcRenderer.off('mcp:changed', wrapped);
  },
  // Lane 14 — marketplace / health / permissions
  getRegistryUrl: (): Promise<McpRegistryUrlResponse> => ipcRenderer.invoke('mcp:get-registry-url'),
  setRegistryUrl: (url: string | null): Promise<McpRegistryUrlResponse> =>
    ipcRenderer.invoke('mcp:set-registry-url', { url }),
  fetchRegistry: (): Promise<McpFetchRegistryResponse> => ipcRenderer.invoke('mcp:fetch-registry'),
  getHealthStats: (): Promise<McpHealthStatsResponse> => ipcRenderer.invoke('mcp:get-health-stats'),
  getPermissions: (): Promise<McpPermissionsResponse> => ipcRenderer.invoke('mcp:get-permissions'),
  revokePermission: (req: McpRevokePermissionRequest): Promise<McpRevokePermissionResponse> =>
    ipcRenderer.invoke('mcp:revoke-permission', req),
  runTool: (req: McpRunToolRequest): Promise<McpRunToolResponse> =>
    ipcRenderer.invoke('mcp:run-tool', req),
  listServerTools: (req: McpListServerToolsRequest): Promise<McpListServerToolsResponse> =>
    ipcRenderer.invoke('mcp:list-server-tools', req),
};

const onboarding = {
  getState: (): Promise<{ complete: boolean; steps: Record<string, unknown> }> =>
    ipcRenderer.invoke('onboarding:get-state'),
  setComplete: (complete: boolean): Promise<{ complete: boolean }> =>
    ipcRenderer.invoke('onboarding:set-complete', { complete }),
  getStep: (stepName: string): Promise<{ value: unknown }> =>
    ipcRenderer.invoke('onboarding:get-step', { stepName }),
  setStep: (stepName: string, value: unknown): Promise<{ steps: Record<string, unknown> }> =>
    ipcRenderer.invoke('onboarding:set-step', { stepName, value }),
  clearSteps: (): Promise<{ steps: Record<string, unknown> }> =>
    ipcRenderer.invoke('onboarding:clear-steps'),
  getDefaults: (): Promise<{ homedir: string }> => ipcRenderer.invoke('onboarding:get-defaults'),
};

const plugins = {
  list: (): Promise<{ plugins: PluginListItem[] }> => ipcRenderer.invoke('plugins:list'),
  installFromPath: (req: InstallPluginRequest): Promise<{ plugins: PluginListItem[] }> =>
    ipcRenderer.invoke('plugins:install-from-path', req),
  browseAndInstall: (): Promise<{ plugins: PluginListItem[]; canceled: boolean }> =>
    ipcRenderer.invoke('plugins:browse-and-install'),
  setEnabled: (req: EnablePluginRequest): Promise<{ plugins: PluginListItem[] }> =>
    ipcRenderer.invoke('plugins:set-enabled', req),
  grantPermissions: (req: GrantPluginPermissionsRequest): Promise<{ plugins: PluginListItem[] }> =>
    ipcRenderer.invoke('plugins:grant-permissions', req),
  uninstall: (req: UninstallPluginRequest): Promise<{ plugins: PluginListItem[] }> =>
    ipcRenderer.invoke('plugins:uninstall', req),
  getRegistryUrl: (): Promise<{ url: string | null }> =>
    ipcRenderer.invoke('plugins:get-registry-url'),
  setRegistryUrl: (url: string | null): Promise<{ url: string | null }> =>
    ipcRenderer.invoke('plugins:set-registry-url', { url }),
  fetchRegistry: (): Promise<{ entries: unknown[]; error: string | null }> =>
    ipcRenderer.invoke('plugins:fetch-registry'),
  installFromRegistry: (req: {
    installUrl: string;
    acceptUnsigned?: boolean;
  }): Promise<
    | { ok: true; plugins: PluginListItem[] }
    | { ok: false; reason: 'unsigned'; pluginName: string }
    | { ok: false; reason: 'error'; error: string }
  > => ipcRenderer.invoke('plugins:install-from-registry', req),
  listPanels: (): Promise<{ panels: PluginPanelDescriptor[] }> =>
    ipcRenderer.invoke('plugins:list-panels'),
  listPresets: (): Promise<PluginPreset[]> => ipcRenderer.invoke('plugins:list-presets'),
  installPreset: (presetId: string): Promise<{ plugins: PluginListItem[] }> =>
    ipcRenderer.invoke('plugins:install-preset', { presetId }),
  onChanged: (listener: PluginsChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: PluginsChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('plugins:changed', wrapped);
    return () => ipcRenderer.off('plugins:changed', wrapped);
  },
};

type AgentRunsChangedListener = (payload: AgentRunsChangedEvent) => void;
type RunnersChangedListener = (payload: RunnersChangedEvent) => void;

const agent = {
  listRuns: (): Promise<AgentRun[]> => ipcRenderer.invoke('agent:list-runs'),
  clearRuns: (): Promise<AgentRun[]> => ipcRenderer.invoke('agent:clear-runs'),
  markRunsSeen: (runIds: string[]): Promise<{ ok: true; runs: AgentRun[] }> =>
    ipcRenderer.invoke('agent:mark-runs-seen', { runIds }),
  onRunsChanged: (listener: AgentRunsChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: AgentRunsChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('agent:runs-changed', wrapped);
    return () => ipcRenderer.off('agent:runs-changed', wrapped);
  },
  getMergeBundle: (
    runId: string,
  ): Promise<{ runId: string; diff: string; files: string[]; branch: string }> =>
    ipcRenderer.invoke('agent:get-merge-bundle', { runId }),
  acceptMerge: (runId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:accept-merge', { runId }),
  rejectMerge: (runId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:reject-merge', { runId }),
  spawnFromUi: (req: AgentSpawnFromUiRequest): Promise<AgentSpawnFromUiResponse> =>
    ipcRenderer.invoke('agent:spawn-from-ui', req),
  abortRun: (runId: string): Promise<AgentAbortRunResponse> =>
    ipcRenderer.invoke('agent:abort-run', { runId }),
  listRunners: (): Promise<RunnerInfo[]> => ipcRenderer.invoke('agent:list-runners'),
  checkRunnerInstalled: (runnerId: string): Promise<RunnerInstallCheck> =>
    ipcRenderer.invoke('agent:check-runner-installed', { runnerId }),
  onRunnersChanged: (listener: RunnersChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: RunnersChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('agent:runners-changed', wrapped);
    return () => ipcRenderer.off('agent:runners-changed', wrapped);
  },
  // Lane 2 — resume prompt
  onResumePrompt: (listener: (payload: AgentResumePromptEvent) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: AgentResumePromptEvent): void =>
      listener(payload);
    ipcRenderer.on('agent:resume-prompt', wrapped);
    return () => ipcRenderer.off('agent:resume-prompt', wrapped);
  },
  respondResume: (
    runId: string,
    decision: AgentResumeDecision,
  ): Promise<AgentRespondResumeResponse> =>
    ipcRenderer.invoke('agent:respond-resume', { runId, decision }),
  // Lane 17 — pause/resume + worktree preview + fanout consent
  pauseRun: (runId: string): Promise<PauseRunResponse> =>
    ipcRenderer.invoke('agent:pause-run', { runId }),
  resumeRun: (runId: string): Promise<ResumeRunResponse> =>
    ipcRenderer.invoke('agent:resume-run', { runId }),
  getWorktreePreview: (runId: string): Promise<WorktreePreviewResponse> =>
    ipcRenderer.invoke('agent:get-worktree-preview', { runId }),
  fanoutConsent: (req: {
    runId: string;
    decision: FanoutConsentDecision;
    editedPlan?: FanoutPlanTask[];
  }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('agent:fanout-consent', req),
  onPausedChanged: (listener: (payload: RunPausedChangedEvent) => void): (() => void) => {
    const wrapped = (_e: IpcRendererEvent, payload: RunPausedChangedEvent): void =>
      listener(payload);
    ipcRenderer.on(runPausedChangedChannel, wrapped);
    return () => ipcRenderer.off(runPausedChangedChannel, wrapped);
  },
  onFanoutConsentRequested: (
    listener: (payload: FanoutConsentRequestedEvent) => void,
  ): (() => void) => {
    const wrapped = (_e: IpcRendererEvent, payload: FanoutConsentRequestedEvent): void =>
      listener(payload);
    ipcRenderer.on(fanoutConsentRequestedChannel, wrapped);
    return () => ipcRenderer.off(fanoutConsentRequestedChannel, wrapped);
  },
};

const codebase = {
  search: (req: CodebaseSearchRequest): Promise<CodebaseSearchResponse> =>
    ipcRenderer.invoke('codebase:search', req),
  readFile: (req: CodebaseReadFileRequest): Promise<CodebaseReadFileResponse> =>
    ipcRenderer.invoke('codebase:read-file', req),
  getPendingEdits: (): Promise<CodebasePendingEditsResponse> =>
    ipcRenderer.invoke('codebase:get-pending-edits'),
  listDirFiles: (req: CodebaseListDirFilesRequest): Promise<CodebaseListDirFilesResponse> =>
    ipcRenderer.invoke('codebase:list-dir-files', req),
};

const git = {
  isRepo: (path: string): Promise<GitIsRepoResponse> => ipcRenderer.invoke('git:is-repo', { path }),
  initRepo: (req: GitInitRequest): Promise<GitInitResult> =>
    ipcRenderer.invoke('git:init-repo', req),
  // Lane 9 — git workflow
  branchFromConversation: (
    req: GitBranchFromConversationRequest,
  ): Promise<GitBranchFromConversationResponse> =>
    ipcRenderer.invoke('git:branch-from-conversation', req),
  commitHunks: (req: GitCommitHunksRequest): Promise<GitCommitHunksResponse> =>
    ipcRenderer.invoke('git:commit-hunks', req),
  draftPr: (req: GitDraftPrRequest): Promise<GitDraftPrResponse> =>
    ipcRenderer.invoke('git:draft-pr', req),
  openPrInBrowser: (req: GitOpenPrInBrowserRequest): Promise<GitOpenPrInBrowserResponse> =>
    ipcRenderer.invoke('git:open-pr-in-browser', req),
  listConflicts: (req: ListConflictsRequest): Promise<ListConflictsResponse> =>
    ipcRenderer.invoke('git:list-conflicts', req),
  resolveConflict: (req: ResolveConflictRequest): Promise<ResolveConflictResponse> =>
    ipcRenderer.invoke('git:resolve-conflict', req),
};

type RunnerInstallProgressListener = (payload: RunnerInstallProgress) => void;
type RunnerFriendlyErrorListener = (payload: RunnerFriendlyError) => void;

const runner = {
  getInstallablePackageManagers: (): Promise<{ managers: PackageManager[] }> =>
    ipcRenderer.invoke('runner:list-package-managers'),
  install: (req: RunnerInstallRequest): Promise<RunnerInstallResult> =>
    ipcRenderer.invoke('runner:install', req),
  onInstallProgress: (listener: RunnerInstallProgressListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: RunnerInstallProgress): void =>
      listener(payload);
    ipcRenderer.on('runner:install-progress', wrapped);
    return () => ipcRenderer.off('runner:install-progress', wrapped);
  },
  probeAuth: (runnerId: string): Promise<RunnerProbeResult> =>
    ipcRenderer.invoke('runner:probe-auth', { runnerId }),
  onFriendlyError: (listener: RunnerFriendlyErrorListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: RunnerFriendlyError): void =>
      listener(payload);
    ipcRenderer.on('runner:friendly-error', wrapped);
    return () => ipcRenderer.off('runner:friendly-error', wrapped);
  },
};

const shellBridge = {
  showItemInFolder: (workspaceRoot: string, path: string): Promise<ShellShowItemResponse> =>
    ipcRenderer.invoke('shell:show-item-in-folder', { workspaceRoot, path }),
  openPath: (workspaceRoot: string, path: string): Promise<ShellOpenPathResponse> =>
    ipcRenderer.invoke('shell:open-path', { workspaceRoot, path }),
};

type TelemetryConfigChangedListener = (payload: TelemetryConfigChangedEvent) => void;

const telemetry = {
  getConfig: (): Promise<TelemetryConfig> => ipcRenderer.invoke('telemetry:get-config'),
  setConfig: (req: TelemetrySetConfigRequest): Promise<TelemetryConfig> =>
    ipcRenderer.invoke('telemetry:set-config', req),
  onConfigChanged: (listener: TelemetryConfigChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: TelemetryConfigChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('telemetry:config-changed', wrapped);
    return () => ipcRenderer.off('telemetry:config-changed', wrapped);
  },
};

type CrashReportingConfigChangedListener = (payload: CrashReportingConfigChangedEvent) => void;

const crashReporting = {
  getConfig: (): Promise<CrashReportingConfig> => ipcRenderer.invoke('crash-reporting:get-config'),
  setConfig: (req: CrashReportingSetConfigRequest): Promise<CrashReportingConfig> =>
    ipcRenderer.invoke('crash-reporting:set-config', req),
  onConfigChanged: (listener: CrashReportingConfigChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: CrashReportingConfigChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('crash-reporting:config-changed', wrapped);
    return () => ipcRenderer.off('crash-reporting:config-changed', wrapped);
  },
};

type UpdatesStatusListener = (payload: UpdateStatus) => void;

const updates = {
  check: (): Promise<UpdatesCheckResult> => ipcRenderer.invoke('updates:check'),
  download: (): Promise<void> => ipcRenderer.invoke('updates:download'),
  quitAndInstall: (): Promise<void> => ipcRenderer.invoke('updates:quit-and-install'),
  getStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('updates:get-status'),
  setAutoCheck: (enabled: boolean): Promise<{ enabled: boolean }> =>
    ipcRenderer.invoke('updates:set-auto-check', { enabled }),
  onStatusChanged: (listener: UpdatesStatusListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: UpdateStatus): void => listener(payload);
    ipcRenderer.on('updates:status-changed', wrapped);
    return () => ipcRenderer.off('updates:status-changed', wrapped);
  },
};

type SchedulerTasksChangedListener = (payload: ScheduledTasksChangedEvent) => void;
type SchedulerRunCompletedListener = (payload: ScheduledRunCompletedEvent) => void;

const scheduler = {
  listTasks: (): Promise<ScheduledTask[]> => ipcRenderer.invoke('scheduler:list-tasks'),
  createTask: (req: CreateScheduledTaskRequest): Promise<ScheduledTask> =>
    ipcRenderer.invoke('scheduler:create-task', req),
  updateTask: (req: UpdateScheduledTaskRequest): Promise<ScheduledTask> =>
    ipcRenderer.invoke('scheduler:update-task', req),
  deleteTask: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('scheduler:delete-task', { id }),
  runNow: (id: string): Promise<RunNowResponse> => ipcRenderer.invoke('scheduler:run-now', { id }),
  listRuns: (req: ListRunsRequest): Promise<ListRunsResponse> =>
    ipcRenderer.invoke('scheduler:list-runs', req),
  getRun: (id: string): Promise<ScheduledTaskRun | null> =>
    ipcRenderer.invoke('scheduler:get-run', { id }),
  getTriggerUrl: (taskId: string): Promise<{ url: string | null }> =>
    ipcRenderer.invoke('scheduler:get-trigger-url', { taskId }),
  installGitHook: (taskId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('scheduler:install-git-hook', { taskId }),
  uninstallGitHook: (taskId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('scheduler:uninstall-git-hook', { taskId }),
  reinstallGitHooks: (): Promise<{ installed: number; errors: string[] }> =>
    ipcRenderer.invoke('scheduler:reinstall-git-hooks'),
  onTasksChanged: (listener: SchedulerTasksChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: ScheduledTasksChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('scheduler:tasks-changed', wrapped);
    return () => ipcRenderer.off('scheduler:tasks-changed', wrapped);
  },
  onRunCompleted: (listener: SchedulerRunCompletedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: ScheduledRunCompletedEvent): void =>
      listener(payload);
    ipcRenderer.on('scheduler:run-completed', wrapped);
    return () => ipcRenderer.off('scheduler:run-completed', wrapped);
  },
};

type SkillsChangedListener = (payload: SkillsChangedEvent) => void;

const skills = {
  list: (): Promise<SkillsListResponse> => ipcRenderer.invoke('skills:list'),
  reload: (): Promise<SkillsListResponse> => ipcRenderer.invoke('skills:reload'),
  createFromTemplate: (req: CreateSkillFromTemplateRequest): Promise<SkillsListResponse> =>
    ipcRenderer.invoke('skills:create-from-template', req),
  importFromUrl: (req: ImportSkillFromUrlRequest): Promise<SkillsListResponse> =>
    ipcRenderer.invoke('skills:import-from-url', req),
  setEnabled: (req: SetSkillEnabledRequest): Promise<SkillsListResponse> =>
    ipcRenderer.invoke('skills:set-enabled', req),
  openInEditor: (req: OpenSkillInEditorRequest): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('skills:open-in-editor', req),
  installStarterPack: (names?: string[]): Promise<SkillsListResponse> =>
    ipcRenderer.invoke('skills:install-starter-pack', names ? { names } : {}),
  getRegistryUrl: (): Promise<{ url: string | null }> =>
    ipcRenderer.invoke('skills:get-registry-url'),
  setRegistryUrl: (url: string | null): Promise<{ url: string | null }> =>
    ipcRenderer.invoke('skills:set-registry-url', { url }),
  fetchRegistry: (): Promise<{ entries: SkillRegistryEntry[]; error: string | null }> =>
    ipcRenderer.invoke('skills:fetch-registry'),
  onChanged: (listener: SkillsChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: SkillsChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('skills:changed', wrapped);
    return () => ipcRenderer.off('skills:changed', wrapped);
  },
};

type MemoryChangedListener = (payload: MemoryConfigChangedEvent) => void;

const memory = {
  getStatus: (): Promise<MemoryStatus> => ipcRenderer.invoke('memory:get-status'),
  getConfig: async (): Promise<MemoryConfig> => {
    const status = (await ipcRenderer.invoke('memory:get-status')) as MemoryStatus;
    return status.config;
  },
  setConfig: (config: MemoryConfig): Promise<MemoryStatus> =>
    ipcRenderer.invoke('memory:set-config', { config }),
  testConnection: (backend: MemoryBackendId): Promise<TestConnectionResult> =>
    ipcRenderer.invoke('memory:test-connection', { backend }),
  setNotionToken: (token: string): Promise<MemoryStatus> =>
    ipcRenderer.invoke('memory:set-notion-token', { token }),
  clearNotionToken: (): Promise<MemoryStatus> => ipcRenderer.invoke('memory:clear-notion-token'),
  reload: (): Promise<MemoryStatus> => ipcRenderer.invoke('memory:reload'),
  // Lane 7 — local FS backend helpers
  readLocal: (): Promise<{ path: string; content: string; bytes: number } | null> =>
    ipcRenderer.invoke('memory-local-fs:read'),
  searchLocal: (
    query: string,
    limit?: number,
  ): Promise<Array<{ id: string; heading: string; score: number; snippet: string }>> =>
    ipcRenderer.invoke(
      'memory-local-fs:search',
      limit === undefined ? { query } : { query, limit },
    ),
  appendLocal: (
    heading: string,
    content: string,
  ): Promise<{ path: string; bytesWritten: number; appendedSection: string }> =>
    ipcRenderer.invoke('memory-local-fs:append', { heading, content }),
  onChanged: (listener: MemoryChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: MemoryConfigChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('memory:config-changed', wrapped);
    return () => ipcRenderer.off('memory:config-changed', wrapped);
  },
};

type UiErrorListener = (payload: UiErrorEvent) => void;

const ui = {
  onError: (listener: UiErrorListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: UiErrorEvent): void => listener(payload);
    ipcRenderer.on('ui:error', wrapped);
    return () => ipcRenderer.off('ui:error', wrapped);
  },
};

// Lane: phase14-tier1-cost-ceiling — Budgets
type BudgetWarningListener = (payload: BudgetWarningEvent) => void;
type BudgetExceededListener = (payload: BudgetExceededEvent) => void;

const budgets = {
  list: (): Promise<Budget[]> => ipcRenderer.invoke('budgets:list'),
  create: (req: CreateBudgetRequest): Promise<Budget> => ipcRenderer.invoke('budgets:create', req),
  update: (req: UpdateBudgetRequest): Promise<Budget> => ipcRenderer.invoke('budgets:update', req),
  delete: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('budgets:delete', { id } satisfies DeleteBudgetRequest),
  getCurrentSpend: (req: GetCurrentSpendRequest): Promise<GetCurrentSpendResponse> =>
    ipcRenderer.invoke('budgets:get-current-spend', req),
  onWarning: (listener: BudgetWarningListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: BudgetWarningEvent): void =>
      listener(payload);
    ipcRenderer.on('budget:warning', wrapped);
    return () => ipcRenderer.off('budget:warning', wrapped);
  },
  onExceeded: (listener: BudgetExceededListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: BudgetExceededEvent): void =>
      listener(payload);
    ipcRenderer.on('budget:exceeded', wrapped);
    return () => ipcRenderer.off('budget:exceeded', wrapped);
  },
};

// Lane 4 — multi-workspace
type WorkspacesChangedListener = (payload: WorkspacesChangedEvent) => void;

const workspaces = {
  list: (): Promise<ListWorkspacesResponse> => ipcRenderer.invoke('workspaces:list'),
  create: (req: CreateWorkspaceRequest): Promise<ListWorkspacesResponse> =>
    ipcRenderer.invoke('workspaces:create', req),
  delete: (req: DeleteWorkspaceRequest): Promise<ListWorkspacesResponse> =>
    ipcRenderer.invoke('workspaces:delete', req),
  setPrimary: (req: SetPrimaryWorkspaceRequest): Promise<ListWorkspacesResponse> =>
    ipcRenderer.invoke('workspaces:set-primary', req),
  setRagEnabled: (req: SetWorkspaceRagEnabledRequest): Promise<ListWorkspacesResponse> =>
    ipcRenderer.invoke('workspaces:set-rag-enabled', req),
  linkToConversation: (req: LinkWorkspaceRequest): Promise<{ workspaces: WorkspaceEntry[] }> =>
    ipcRenderer.invoke('workspaces:link-to-conversation', req),
  unlinkFromConversation: (
    req: UnlinkWorkspaceRequest,
  ): Promise<{ workspaces: WorkspaceEntry[] }> =>
    ipcRenderer.invoke('workspaces:unlink-from-conversation', req),
  listForConversation: (conversationId: string): Promise<{ workspaces: WorkspaceEntry[] }> =>
    ipcRenderer.invoke('workspaces:list-for-conversation', {
      conversationId,
    } satisfies ListConversationWorkspacesRequest),
  onChanged: (listener: WorkspacesChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: WorkspacesChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('workspaces:changed', wrapped);
    return () => ipcRenderer.off('workspaces:changed', wrapped);
  },
};

// Lane 5 — routing
type RoutingChangedListener = (payload: RoutingChangedEvent) => void;

const routing = {
  getState: (): Promise<RoutingState> => ipcRenderer.invoke('routing:get-state'),
  createPolicy: (req: CreateRoutingPolicyRequest): Promise<RoutingState> =>
    ipcRenderer.invoke('routing:create-policy', req),
  updatePolicy: (req: UpdateRoutingPolicyRequest): Promise<RoutingState> =>
    ipcRenderer.invoke('routing:update-policy', req),
  deletePolicy: (req: DeleteRoutingPolicyRequest): Promise<RoutingState> =>
    ipcRenderer.invoke('routing:delete-policy', req),
  setActive: (req: SetActiveRoutingPolicyRequest): Promise<RoutingState> =>
    ipcRenderer.invoke('routing:set-active', req),
  onChanged: (listener: RoutingChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: RoutingChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('routing:changed', wrapped);
    return () => ipcRenderer.off('routing:changed', wrapped);
  },
};

// Lane 6 — replay & provenance
type ReplayProgressListener = (payload: ReplayProgressEvent) => void;

const replay = {
  listAppliedDiffs: (req: ListAppliedDiffsRequest): Promise<ListAppliedDiffsResponse> =>
    ipcRenderer.invoke('replay:list-applied-diffs', req),
  getAppliedDiff: (req: GetAppliedDiffRequest): Promise<AppliedDiff | null> =>
    ipcRenderer.invoke('replay:get-applied-diff', req),
  exportProvenanceBundle: (
    req: ExportProvenanceBundleRequest,
  ): Promise<ExportProvenanceBundleResponse> =>
    ipcRenderer.invoke('replay:export-provenance-bundle', req),
  getConversationBundle: (
    id: string,
  ): Promise<{ bundle: ProvenanceBundle | null; signature: string | null }> =>
    ipcRenderer.invoke('replay:get-conversation-bundle', { id }),
  replayConversation: (req: ReplayConversationRequest): Promise<ReplayResult> =>
    ipcRenderer.invoke('replay:replay-conversation', req),
  replayDiff: (req: ReplayDiffRequest): Promise<ReplayDiffResult> =>
    ipcRenderer.invoke('replay:replay-diff', req),
  onProgress: (listener: ReplayProgressListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: ReplayProgressEvent): void =>
      listener(payload);
    ipcRenderer.on('replay:progress', wrapped);
    return () => ipcRenderer.off('replay:progress', wrapped);
  },
};

// Unified checkpoint manager — per-turn + pre-run rollback
type CheckpointsChangedListener = (payload: CheckpointsChangedEvent) => void;

const checkpoints = {
  listForMessage: (messageId: string): Promise<ListCheckpointsResponse> =>
    ipcRenderer.invoke('checkpoints:list-for-message', {
      messageId,
    } satisfies ListCheckpointsForMessageRequest),
  listForRun: (runId: string): Promise<ListCheckpointsResponse> =>
    ipcRenderer.invoke('checkpoints:list-for-run', {
      runId,
    } satisfies ListCheckpointsForRunRequest),
  restore: (checkpointId: string): Promise<RestoreCheckpointResponse> =>
    ipcRenderer.invoke('checkpoints:restore', {
      checkpointId,
    } satisfies RestoreCheckpointRequest),
  onChanged: (listener: CheckpointsChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: CheckpointsChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('checkpoints:changed', wrapped);
    return () => ipcRenderer.off('checkpoints:changed', wrapped);
  },
};

// Lane 7 — anti-sycophancy toggle
const antiSycophancy = {
  get: (): Promise<boolean> => ipcRenderer.invoke('anti-sycophancy:get'),
  set: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('anti-sycophancy:set', { enabled }),
};

// Lane 8 — Ollama probe/install
type OllamaInstallProgressListener = (payload: OllamaInstallProgress) => void;

const ollama = {
  probe: (): Promise<OllamaProbeResult> => ipcRenderer.invoke('ollama:probe'),
  install: (req: OllamaInstallRequest): Promise<OllamaInstallResult> =>
    ipcRenderer.invoke('ollama:install', req),
  listInstallableManagers: (): Promise<OllamaListInstallersResponse> =>
    ipcRenderer.invoke('ollama:list-installable-managers'),
  onInstallProgress: (listener: OllamaInstallProgressListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: OllamaInstallProgress): void =>
      listener(payload);
    ipcRenderer.on('ollama:install-progress', wrapped);
    return () => ipcRenderer.off('ollama:install-progress', wrapped);
  },
};

// Lane 10 — Reviewer
const review = {
  fetchDiff: (req: FetchDiffRequest): Promise<FetchDiffResponse> =>
    ipcRenderer.invoke('review:fetch-diff', req),
  generateFindings: (req: GenerateFindingsRequest): Promise<GenerateFindingsResponse> =>
    ipcRenderer.invoke('review:generate-findings', req),
  postComments: (req: PostCommentsRequest): Promise<PostCommentsResponse> =>
    ipcRenderer.invoke('review:post-comments', req),
};

// Lane 11 — Privacy / network policy
type NetworkPolicyChangedListener = (payload: NetworkPolicyChangedEvent) => void;

const network = {
  getPolicy: (): Promise<NetworkPolicy> => ipcRenderer.invoke('network:get-policy'),
  setLocalOnly: (enabled: boolean): Promise<NetworkPolicy> =>
    ipcRenderer.invoke('network:set-local-only', {
      enabled,
    } satisfies SetLocalOnlyModeRequest),
  addAllowlistEntry: (hostname: string): Promise<NetworkPolicy> =>
    ipcRenderer.invoke('network:add-allowlist-entry', {
      hostname,
    } satisfies AddAllowlistEntryRequest),
  removeAllowlistEntry: (hostname: string): Promise<NetworkPolicy> =>
    ipcRenderer.invoke('network:remove-allowlist-entry', {
      hostname,
    } satisfies RemoveAllowlistEntryRequest),
  onChanged: (listener: NetworkPolicyChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: NetworkPolicyChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('network:policy-changed', wrapped);
    return () => ipcRenderer.off('network:policy-changed', wrapped);
  },
};

// Lane 13 — Voice
type VoiceDownloadProgressListener = (payload: DownloadProgressEvent) => void;
type VoicePttListener = (payload: VoicePttEvent) => void;

const voice = {
  checkBinary: (): Promise<CheckBinaryResponse> => ipcRenderer.invoke('voice:check-binary'),
  downloadModel: (model: WhisperModel): Promise<DownloadModelResponse> =>
    ipcRenderer.invoke('voice:download-model', { model }),
  startRecording: (model?: WhisperModel): Promise<StartRecordingResponse> =>
    ipcRenderer.invoke('voice:start-recording', model ? { model } : {}),
  stopRecording: (req: {
    sessionId: string;
    pcm16Base64: string;
  }): Promise<StopRecordingResponse> => ipcRenderer.invoke('voice:stop-recording', req),
  setPttShortcut: (accelerator: string): Promise<SetPttShortcutResponse> =>
    ipcRenderer.invoke('voice:set-ptt-shortcut', { accelerator }),
  getConfig: (): Promise<GetVoiceConfigResponse> => ipcRenderer.invoke('voice:get-config'),
  setSelectedModel: (model: WhisperModel): Promise<GetVoiceConfigResponse> =>
    ipcRenderer.invoke('voice:set-selected-model', { model }),
  setBinaryPath: (path: string | null): Promise<GetVoiceConfigResponse> =>
    ipcRenderer.invoke('voice:set-binary-path', { path }),
  onDownloadProgress: (listener: VoiceDownloadProgressListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: DownloadProgressEvent): void =>
      listener(payload);
    ipcRenderer.on('voice:download-progress', wrapped);
    return () => ipcRenderer.off('voice:download-progress', wrapped);
  },
  onPttEvent: (listener: VoicePttListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: VoicePttEvent): void => listener(payload);
    ipcRenderer.on('voice:ptt-event', wrapped);
    return () => ipcRenderer.off('voice:ptt-event', wrapped);
  },
};

// Lane 15 — pair suggestions
type PairSuggestionListener = (evt: PairSuggestionEvent) => void;

const pair = {
  getActiveSuggestions: (
    req: PairGetActiveSuggestionsRequest,
  ): Promise<PairGetActiveSuggestionsResponse> =>
    ipcRenderer.invoke('pair:get-active-suggestions', req),
  dismissSuggestion: (req: PairDismissSuggestionRequest): Promise<PairDismissSuggestionResponse> =>
    ipcRenderer.invoke('pair:dismiss-suggestion', req),
  applyAsContext: (req: PairApplyAsContextRequest): Promise<PairApplyAsContextResponse> =>
    ipcRenderer.invoke('pair:apply-as-context', req),
  setActiveConversation: (req: PairSetActiveConversationRequest): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('pair:set-active-conversation', req),
  onSuggestion: (listener: PairSuggestionListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: PairSuggestionEvent): void =>
      listener(payload);
    ipcRenderer.on('pair:suggestion', wrapped);
    return () => ipcRenderer.off('pair:suggestion', wrapped);
  },
};

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  onDeepLink: (listener: DeepLinkListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, url: string): void => listener(url);
    ipcRenderer.on('app:deep-link', wrapped);
    return () => ipcRenderer.off('app:deep-link', wrapped);
  },
  ui,
  providers,
  selectedModel,
  conversations,
  chat,
  attachments,
  approvals,
  tools,
  toolAudit,
  theme,
  settings,
  workspace,
  workspaces,
  mcp,
  onboarding,
  plugins,
  agent,
  antiSycophancy,
  checkpoints,
  budgets,
  network,
  ollama,
  pair,
  replay,
  review,
  routing,
  runner,
  codebase,
  git,
  shell: shellBridge,
  telemetry,
  crashReporting,
  updates,
  memory,
  scheduler,
  skills,
  voice,
  fileTree: {
    list: (
      path?: string,
    ): Promise<{
      entries: Array<{ name: string; path: string; isDirectory: boolean; hasChildren: boolean }>;
      workspaceRoot: string | null;
      truncated: boolean;
    }> => ipcRenderer.invoke('file-tree:list', { path }),
    hasChildren: (path: string): Promise<{ hasChildren: boolean }> =>
      ipcRenderer.invoke('file-tree:has-children', { path }),
  },
} as const;

export type OpenCodexBridge = typeof api;

contextBridge.exposeInMainWorld('opencodex', api);
