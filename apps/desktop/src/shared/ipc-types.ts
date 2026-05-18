/**
 * Typed IPC channel contracts shared between main and renderer.
 * Both sides import from here so the wire format stays in sync.
 */

import type {
  ProviderDeleteRequest,
  ProviderListItem,
  ProviderSaveRequest,
  ProviderSaveResponse,
  ProviderTestRequest,
  ProviderTestResult,
} from './provider-config';

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
}

export interface IpcEventChannels {
  'app:deep-link': string;
}

export type IpcInvokeChannel = keyof IpcInvokeChannels;
export type IpcEventChannel = keyof IpcEventChannels;
