import type { OpenCodexBridge } from '../preload';

let warned = false;

export function getBridge(): OpenCodexBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { opencodex?: OpenCodexBridge };
  const bridge = w.opencodex;
  if (!bridge) {
    if (!warned) {
      warned = true;
      console.warn('[opencodex] window.opencodex is not available; preload bridge missing.');
    }
    return null;
  }
  return bridge;
}

export function resetBridgeWarning(): void {
  warned = false;
}
