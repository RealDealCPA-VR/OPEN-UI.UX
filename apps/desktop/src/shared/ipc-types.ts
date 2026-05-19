/**
 * Typed IPC channel contracts shared between main and renderer.
 * Both sides import from here so the wire format stays in sync.
 */

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
  RemoveWorkspaceRequest,
  SetActiveWorkspaceRequest,
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
}

export interface IpcEventChannels {
  'app:deep-link': string;
  'chat:event': ChatStreamEvent;
  'chat:approval-request': ApprovalRequest;
  'settings:theme-changed': ThemeChangedEvent;
}

export type IpcInvokeChannel = keyof IpcInvokeChannels;
export type IpcEventChannel = keyof IpcEventChannels;
