import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  ProviderDeleteRequest,
  ProviderListItem,
  ProviderSaveRequest,
  ProviderSaveResponse,
  ProviderTestRequest,
  ProviderTestResult,
} from '../shared/provider-config';

type DeepLinkListener = (url: string) => void;

const providers = {
  list: (): Promise<ProviderListItem[]> => ipcRenderer.invoke('providers:list'),
  save: (req: ProviderSaveRequest): Promise<ProviderSaveResponse> =>
    ipcRenderer.invoke('providers:save', req),
  delete: (req: ProviderDeleteRequest): Promise<ProviderListItem> =>
    ipcRenderer.invoke('providers:delete', req),
  test: (req: ProviderTestRequest): Promise<ProviderTestResult> =>
    ipcRenderer.invoke('providers:test', req),
};

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  onDeepLink: (listener: DeepLinkListener): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, url: string): void => listener(url);
    ipcRenderer.on('app:deep-link', wrapped);
    return () => ipcRenderer.off('app:deep-link', wrapped);
  },
  providers,
} as const;

export type OpenCodexBridge = typeof api;

contextBridge.exposeInMainWorld('opencodex', api);
