/**
 * Typed IPC channel contracts shared between main and renderer.
 * Both sides import from here so the wire format stays in sync.
 */

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
}

export interface IpcEventChannels {
  'app:deep-link': string;
  'chat:event': ChatStreamEvent;
}

export type IpcInvokeChannel = keyof IpcInvokeChannels;
export type IpcEventChannel = keyof IpcEventChannels;
