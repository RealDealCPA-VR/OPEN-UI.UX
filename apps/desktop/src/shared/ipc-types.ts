/**
 * Typed IPC channel contracts shared between main and renderer.
 * Both sides import from here so the wire format stays in sync.
 */

import type { AgentRun, AgentRunsChangedEvent } from './agent-runs';
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
  McpServerChangedEvent,
  McpServerPreset,
  McpState,
  RemoveMcpServerRequest,
  SetMcpServerEnabledRequest,
} from './mcp';
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
}

export type IpcInvokeChannel = keyof IpcInvokeChannels;
export type IpcEventChannel = keyof IpcEventChannels;
