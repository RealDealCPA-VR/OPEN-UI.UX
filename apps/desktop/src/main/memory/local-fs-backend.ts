import {
  LocalFsMemory,
  clipForPrompt,
  DEFAULT_MAX_PREPEND_BYTES,
} from '@opencodex/memory-local-fs';
import type { Tool } from '@opencodex/core';
import { logger } from '../logger';
import { getSettings } from '../storage/settings';

export interface LocalFsBackendRuntime {
  configured: boolean;
  registeredTools: string[];
  toolCount: number;
  lastError?: string;
  workspaceRoot: string | null;
}

export interface LocalFsBackendState {
  enabled: boolean;
  configured: boolean;
  registered: boolean;
  toolCount: number;
  workspaceRoot: string | null;
  lastError?: string;
}

export function buildLocalFsMemoryForActiveWorkspace(): LocalFsMemory | null {
  const workspaceRoot = getSettings().activeWorkspace;
  if (workspaceRoot === null || workspaceRoot.trim().length === 0) return null;
  return new LocalFsMemory({ workspaceRoot });
}

export function buildLocalFsTools(workspaceRoot: string): Tool[] {
  const mem = new LocalFsMemory({ workspaceRoot });
  return mem.buildTools();
}

export async function readLocalMemoryForPrompt(
  workspaceRoot: string,
  maxBytes: number = DEFAULT_MAX_PREPEND_BYTES,
): Promise<string> {
  try {
    const mem = new LocalFsMemory({ workspaceRoot });
    const { content } = await mem.read();
    if (content.length === 0) return '';
    return clipForPrompt(content, maxBytes);
  } catch (err) {
    logger.warn({ err, workspaceRoot }, 'local-fs memory.md read failed');
    return '';
  }
}
