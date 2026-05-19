import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
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
import type {
  ToolCallAuditPurgeResult,
  ToolCallAuditQuery,
  ToolCallAuditQueryResult,
  ToolCallAuditRetention,
} from '../shared/tool-audit';
import type { ToolListItem } from '../shared/tools';
import type {
  RemoveWorkspaceRequest,
  SetActiveWorkspaceRequest,
  WorkspaceState,
} from '../shared/workspace';

type DeepLinkListener = (url: string) => void;
type ChatEventListener = (payload: ChatStreamEvent) => void;
type ApprovalRequestListener = (req: ApprovalRequest) => void;

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

const chat = {
  start: (req: ChatStartRequest): Promise<ChatStartResponse> =>
    ipcRenderer.invoke('chat:start', req),
  cancel: (req: ChatCancelRequest): Promise<void> => ipcRenderer.invoke('chat:cancel', req),
  onEvent: (listener: ChatEventListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: ChatStreamEvent): void => listener(payload);
    ipcRenderer.on('chat:event', wrapped);
    return () => ipcRenderer.off('chat:event', wrapped);
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

const workspace = {
  get: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:get'),
  setActive: (req: SetActiveWorkspaceRequest): Promise<WorkspaceState> =>
    ipcRenderer.invoke('workspace:set-active', req),
  browse: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:browse'),
  remove: (req: RemoveWorkspaceRequest): Promise<WorkspaceState> =>
    ipcRenderer.invoke('workspace:remove', req),
  clearActive: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:clear-active'),
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
  workspace,
} as const;

export type OpenCodexBridge = typeof api;

contextBridge.exposeInMainWorld('opencodex', api);
