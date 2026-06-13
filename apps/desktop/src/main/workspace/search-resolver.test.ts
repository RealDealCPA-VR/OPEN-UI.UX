import Database from 'better-sqlite3';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getSearchWorkspaceResolver,
  setSearchWorkspaceResolver,
  type WorkspaceForSearch,
} from '@opencodex/tools';
import { rmTmp } from '../../test/rm-tmp';
import { applyMigrations, setDbForTesting } from '../storage/db';
import { createWorkspace, setRagEnabled } from './workspaces-store';
import {
  buildSearchWorkspaceResolver,
  installSearchWorkspaceResolver,
  uninstallSearchWorkspaceResolver,
} from './search-resolver';

let db: Database.Database;
let tmpA: string;
let tmpB: string;

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  setDbForTesting(db);
  tmpA = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-search-resolver-a-'));
  tmpB = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-search-resolver-b-'));
});

afterEach(async () => {
  uninstallSearchWorkspaceResolver();
  setDbForTesting(null);
  db.close();
  await rmTmp(tmpA);
  await rmTmp(tmpB);
});

describe('buildSearchWorkspaceResolver', () => {
  it('resolves only RAG-enabled workspaces', () => {
    const a = createWorkspace({ path: tmpA, setPrimary: true });
    const b = createWorkspace({ path: tmpB });
    setRagEnabled(b.id, false);

    const resolver = buildSearchWorkspaceResolver();
    expect(resolver.resolve(a.id)).toEqual({ id: a.id, workspaceRoot: tmpA });
    expect(resolver.resolve(b.id)).toBeNull();
    expect(resolver.listEnabled().map((w: WorkspaceForSearch) => w.id)).toEqual([a.id]);
  });

  it('returns null for unknown ids', () => {
    const resolver = buildSearchWorkspaceResolver();
    expect(resolver.resolve('does-not-exist')).toBeNull();
  });
});

describe('installSearchWorkspaceResolver', () => {
  it('registers and unregisters the module-level resolver', () => {
    installSearchWorkspaceResolver();
    expect(getSearchWorkspaceResolver()).not.toBeNull();
    uninstallSearchWorkspaceResolver();
    expect(getSearchWorkspaceResolver()).toBeNull();
  });

  it('survives explicit reset', () => {
    installSearchWorkspaceResolver();
    setSearchWorkspaceResolver(null);
    expect(getSearchWorkspaceResolver()).toBeNull();
  });
});
