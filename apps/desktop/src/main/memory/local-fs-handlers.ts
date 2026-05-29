import { z } from 'zod';
import type { LocalFsMemory } from '@opencodex/memory-local-fs';
import { registerInvoke } from '../ipc/registry';
import { buildLocalFsMemoryForActiveWorkspace } from './local-fs-backend';
import {
  localFsAppendRequestSchema,
  localFsSearchRequestSchema,
  type LocalFsAppendResponse,
  type LocalFsHit,
  type LocalFsReadResponse,
} from '../../shared/memory-local-fs';

function requireMemory(): LocalFsMemory {
  const mem = buildLocalFsMemoryForActiveWorkspace();
  if (!mem) {
    throw new Error(
      'No active workspace. Set one in Settings → Workspace before using the local memory backend.',
    );
  }
  return mem;
}

export function registerLocalFsMemoryHandlers(): void {
  registerInvoke(
    'memory-local-fs:read',
    z.void(),
    async (): Promise<LocalFsReadResponse | null> => {
      const mem = buildLocalFsMemoryForActiveWorkspace();
      if (!mem) return null;
      const result = await mem.read();
      return { path: result.path, content: result.content, bytes: result.bytes };
    },
  );

  registerInvoke(
    'memory-local-fs:search',
    localFsSearchRequestSchema,
    async (req): Promise<LocalFsHit[]> => {
      const mem = requireMemory();
      return mem.search(req.query, req.limit ?? 5);
    },
  );

  registerInvoke(
    'memory-local-fs:append',
    localFsAppendRequestSchema,
    async (req): Promise<LocalFsAppendResponse> => {
      const mem = requireMemory();
      const result = await mem.append(req.heading, req.content);
      return {
        path: result.path,
        bytesWritten: result.bytesWritten,
        appendedSection: result.appendedSection,
      };
    },
  );
}
