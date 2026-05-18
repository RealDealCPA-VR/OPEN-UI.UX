/**
 * Typed IPC channel contracts shared between main and renderer.
 * Both sides import from here so the wire format stays in sync.
 */

export interface IpcInvokeChannels {
  'app:version': {
    request: void;
    response: string;
  };
}

export interface IpcEventChannels {
  'app:deep-link': string;
}

export type IpcInvokeChannel = keyof IpcInvokeChannels;
export type IpcEventChannel = keyof IpcEventChannels;
