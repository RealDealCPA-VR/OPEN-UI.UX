/**
 * Typed IPC channel contracts shared between main and renderer.
 * Both sides import from here so the wire format stays in sync.
 */

export interface IpcChannels {
  'app:version': {
    request: void;
    response: string;
  };
}

export type IpcChannel = keyof IpcChannels;
