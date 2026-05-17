import type { OpenCodexBridge } from '../preload';

declare global {
  interface Window {
    opencodex: OpenCodexBridge;
  }
}

export {};
