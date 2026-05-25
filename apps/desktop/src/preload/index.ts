import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { AgentRun, AgentRunsChangedEvent } from '../shared/agent-runs';
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
  ChatStartRequest,
  ChatStartResponse,
  ChatStreamEvent,
} from '../shared/chat';
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
};

type ReadOnlyChangedListener = (payload: { readOnly: boolean }) => void;

const chat = {
  start: (req: ChatStartRequest): Promise<ChatStartResponse> =>
    ipcRenderer.invoke('chat:start', req),
  cancel: (req: ChatCancelRequest): Promise<void> => ipcRenderer.invoke('chat:cancel', req),
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

const workspace = {
  get: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:get'),
  setActive: (req: SetActiveWorkspaceRequest): Promise<WorkspaceState> =>
    ipcRenderer.invoke('workspace:set-active', req),
  browse: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:browse'),
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
};

const onboarding = {
  getState: (): Promise<{ complete: boolean }> => ipcRenderer.invoke('onboarding:get-state'),
  setComplete: (complete: boolean): Promise<{ complete: boolean }> =>
    ipcRenderer.invoke('onboarding:set-complete', { complete }),
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
  listPanels: (): Promise<{ panels: PluginPanelDescriptor[] }> =>
    ipcRenderer.invoke('plugins:list-panels'),
  onChanged: (listener: PluginsChangedListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: PluginsChangedEvent): void =>
      listener(payload);
    ipcRenderer.on('plugins:changed', wrapped);
    return () => ipcRenderer.off('plugins:changed', wrapped);
  },
};

type AgentRunsChangedListener = (payload: AgentRunsChangedEvent) => void;

const agent = {
  listRuns: (): Promise<AgentRun[]> => ipcRenderer.invoke('agent:list-runs'),
  clearRuns: (): Promise<AgentRun[]> => ipcRenderer.invoke('agent:clear-runs'),
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
};

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  onDeepLink: (listener: DeepLinkListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, url: string): void => listener(url);
    ipcRenderer.on('app:deep-link', wrapped);
    return () => ipcRenderer.off('app:deep-link', wrapped);
  },
  providers,
  selectedModel,
  conversations,
  chat,
  approvals,
  tools,
  toolAudit,
  theme,
  workspace,
  mcp,
  onboarding,
  plugins,
  agent,
  fileTree: {
    list: (
      path?: string,
    ): Promise<{
      entries: Array<{ name: string; path: string; isDirectory: boolean; hasChildren: boolean }>;
      workspaceRoot: string | null;
    }> => ipcRenderer.invoke('file-tree:list', { path }),
  },
} as const;

export type OpenCodexBridge = typeof api;

contextBridge.exposeInMainWorld('opencodex', api);
