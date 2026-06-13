import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, setDbForTesting } from '../storage/db';
import {
  countCheckpointEntries,
  findActiveTurnCheckpoint,
  getCheckpoint,
  getCheckpointEntries,
  listCheckpointsForMessage,
  listCheckpointsForRun,
} from '../storage/checkpoints';
import { blobsDir, gcOrphanBlobs, putBlob, sha256, setBlobsDirForTesting } from './blob-store';
import {
  MAX_FILE_BYTES,
  captureBeforeMutation,
  createRunCheckpoint,
  gc,
  restoreCheckpoint,
} from './manager';

const execFileAsync = promisify(execFile);

let db: Database.Database;
let workspace: string;
let blobs: string;

function tmp(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  setDbForTesting(db);
  workspace = tmp('ckpt-ws-');
  blobs = tmp('ckpt-blobs-');
  setBlobsDirForTesting(blobs);
});

afterEach(async () => {
  setDbForTesting(null);
  setBlobsDirForTesting(null);
  db.close();
  // maxRetries/retryDelay paper over Windows EBUSY when a handle is still
  // closing (documented flake).
  await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await fs.rm(blobs, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function capture(messageId: string, toolName: string, rel: string): Promise<void> {
  await captureBeforeMutation(
    {
      scope: 'turn',
      conversationId: 'conv1',
      assistantMessageId: messageId,
      workspaceRoot: workspace,
      toolName,
      args: { path: rel },
    },
    db,
  );
}

describe('captureBeforeMutation + restore (turn scope)', () => {
  it('captures original bytes for write_file and restores them exactly', async () => {
    const rel = 'a.txt';
    await fs.writeFile(path.join(workspace, rel), 'ORIGINAL');
    await capture('m1', 'write_file', rel);

    const cp = findActiveTurnCheckpoint('m1', db);
    expect(cp).not.toBeNull();
    const entries = getCheckpointEntries(cp!.id, db);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.preBlobSha).toBe(sha256(Buffer.from('ORIGINAL')));

    // The tool "lands" — file content changes.
    await fs.writeFile(path.join(workspace, rel), 'MUTATED');

    const res = await restoreCheckpoint(cp!.id, db);
    expect(res.restoredCount).toBe(1);
    expect(await fs.readFile(path.join(workspace, rel), 'utf8')).toBe('ORIGINAL');
  });

  it('captures original bytes for edit_file', async () => {
    const rel = 'b.txt';
    await fs.writeFile(path.join(workspace, rel), 'before');
    await capture('m1', 'edit_file', rel);
    await fs.writeFile(path.join(workspace, rel), 'after');

    const cp = findActiveTurnCheckpoint('m1', db)!;
    await restoreCheckpoint(cp.id, db);
    expect(await fs.readFile(path.join(workspace, rel), 'utf8')).toBe('before');
  });

  it('new-file capture (ENOENT) → restore deletes the created file', async () => {
    const rel = 'new.txt';
    await capture('m1', 'write_file', rel);
    // tool creates the file
    await fs.writeFile(path.join(workspace, rel), 'created');

    const cp = findActiveTurnCheckpoint('m1', db)!;
    const entries = getCheckpointEntries(cp.id, db);
    expect(entries[0]?.preBlobSha).toBeNull();

    const res = await restoreCheckpoint(cp.id, db);
    expect(res.deletedCount).toBe(1);
    await expect(fs.access(path.join(workspace, rel))).rejects.toThrow();
  });

  it('dedups paths within a turn — FIRST pre-image wins', async () => {
    const rel = 'c.txt';
    await fs.writeFile(path.join(workspace, rel), 'FIRST');
    await capture('m1', 'write_file', rel);
    // second mutating call to same path, but file already mutated
    await fs.writeFile(path.join(workspace, rel), 'SECOND');
    await capture('m1', 'write_file', rel);

    const cp = findActiveTurnCheckpoint('m1', db)!;
    expect(countCheckpointEntries(cp.id, db)).toBe(1);
    const entries = getCheckpointEntries(cp.id, db);
    expect(entries[0]?.preBlobSha).toBe(sha256(Buffer.from('FIRST')));
  });

  it('restore writes a superseding (undoable) checkpoint', async () => {
    const rel = 'd.txt';
    await fs.writeFile(path.join(workspace, rel), 'ORIG');
    await capture('m1', 'write_file', rel);
    await fs.writeFile(path.join(workspace, rel), 'CHANGED');

    const cp = findActiveTurnCheckpoint('m1', db)!;
    const res = await restoreCheckpoint(cp.id, db);
    expect(res.newCheckpointId).not.toBeNull();

    // The original checkpoint is marked restored.
    expect(getCheckpoint(cp.id, db)?.status).toBe('restored');

    // The undo checkpoint captured the CHANGED bytes, so restoring it returns
    // the workspace to the post-edit state.
    const undo = getCheckpoint(res.newCheckpointId!, db)!;
    const undoEntries = getCheckpointEntries(undo.id, db);
    expect(undoEntries[0]?.preBlobSha).toBe(sha256(Buffer.from('CHANGED')));
    await restoreCheckpoint(undo.id, db);
    expect(await fs.readFile(path.join(workspace, rel), 'utf8')).toBe('CHANGED');
  });

  it('path-escape entries are skipped + reported on restore, never written', async () => {
    const rel = 'safe.txt';
    await fs.writeFile(path.join(workspace, rel), 'safe-orig');
    await capture('m1', 'write_file', rel);

    // Inject a malicious entry whose rel_path escapes the workspace.
    const cp = findActiveTurnCheckpoint('m1', db)!;
    const escapeSha = await putBlob(Buffer.from('PWNED'));
    db.prepare(
      `INSERT INTO checkpoint_entries (id, checkpoint_id, rel_path, pre_blob_sha, pre_size)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('evil', cp.id, '../escape.txt', escapeSha, 5);

    const outside = path.join(workspace, '..', 'escape.txt');
    await fs.rm(outside, { force: true });

    const res = await restoreCheckpoint(cp.id, db);
    expect(res.skipped.some((s) => s.reason === 'path-escape')).toBe(true);
    await expect(fs.access(outside)).rejects.toThrow();
  });

  it('25MB cap → too_large entry skipped + reported on restore', async () => {
    const rel = 'big.bin';
    const big = Buffer.alloc(MAX_FILE_BYTES + 1, 1);
    await fs.writeFile(path.join(workspace, rel), big);
    await capture('m1', 'write_file', rel);

    const cp = findActiveTurnCheckpoint('m1', db)!;
    const entries = getCheckpointEntries(cp.id, db);
    expect(entries[0]?.preBlobSha).toBe('too_large');

    // Mutate then restore — too_large is reported skipped and never written.
    await fs.writeFile(path.join(workspace, rel), Buffer.from('small'));
    const res = await restoreCheckpoint(cp.id, db);
    expect(res.skipped.some((s) => s.reason === 'too-large')).toBe(true);
    expect(await fs.readFile(path.join(workspace, rel), 'utf8')).toBe('small');
  });

  it('non-mutating tools and run_shell are no-ops', async () => {
    await capture('m1', 'read_file', 'a.txt');
    await capture('m1', 'run_shell', 'a.txt');
    expect(findActiveTurnCheckpoint('m1', db)).toBeNull();
  });
});

describe('gc — retention + orphan blobs', () => {
  it('removes orphan blobs not referenced by any entry', async () => {
    await putBlob(Buffer.from('orphan'));
    expect(await gcOrphanBlobs(db)).toBe(1);
  });

  it('keeps referenced blobs', async () => {
    const rel = 'keep.txt';
    await fs.writeFile(path.join(workspace, rel), 'keep');
    await capture('m1', 'write_file', rel);
    const removed = await gcOrphanBlobs(db);
    expect(removed).toBe(0);
  });

  it('gc() runs both retention + blob gc without throwing', async () => {
    await putBlob(Buffer.from('orphan2'));
    const res = await gc(db);
    expect(res.removedBlobs).toBeGreaterThanOrEqual(1);
  });
});

describe('capture failure logs + continues (marks turn non-restorable)', () => {
  it('superseding the active checkpoint when a blob put fails does not throw', async () => {
    // Point the blob store at a path that cannot be written (a file, not a dir)
    // so putBlob fails mid-capture.
    const rel = 'x.txt';
    await fs.writeFile(path.join(workspace, rel), 'data');
    const fileAsDir = path.join(tmp('ckpt-bad-'), 'not-a-dir');
    await fs.writeFile(fileAsDir, 'iam a file');
    setBlobsDirForTesting(fileAsDir);

    await expect(capture('m1', 'write_file', rel)).resolves.toBeUndefined();
    // The active turn checkpoint, if created, is superseded — not left active.
    const cp = findActiveTurnCheckpoint('m1', db);
    expect(cp).toBeNull();
    setBlobsDirForTesting(blobs);
  });
});

describe('createRunCheckpoint — git tracked + untracked round-trip', () => {
  async function git(args: string[]): Promise<void> {
    await execFileAsync('git', args, { cwd: workspace, windowsHide: true });
  }

  async function gitAvailable(): Promise<boolean> {
    try {
      await execFileAsync('git', ['--version'], { windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }

  it('restores tracked edits and deletes untracked files created by the run', async () => {
    if (!(await gitAvailable())) return;
    await git(['init', '-q']);
    await git(['config', 'user.email', 't@t.t']);
    await git(['config', 'user.name', 'T']);
    await fs.writeFile(path.join(workspace, 'tracked.txt'), 'v1\n');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'init']);

    const checkpointId = await createRunCheckpoint({ runId: 'run1', workspaceRoot: workspace }, db);
    expect(checkpointId).not.toBeNull();
    const cp = getCheckpoint(checkpointId!, db)!;
    expect(cp.kind).toBe('git');
    expect(cp.gitBaseSha).toBeTruthy();

    // Run mutates tracked file + creates an untracked file AFTER capture.
    await fs.writeFile(path.join(workspace, 'tracked.txt'), 'v2-mutated\n');
    await fs.writeFile(path.join(workspace, 'untracked.txt'), 'new');

    // untracked.txt has no checkpoint entry (it did not exist pre-run), so
    // restore must delete it in addition to resetting the tracked edit.
    const res = await restoreCheckpoint(cp.id, db);
    expect(res.restoredCount).toBeGreaterThanOrEqual(1);
    expect(res.deletedCount).toBeGreaterThanOrEqual(1);
    expect(await fs.readFile(path.join(workspace, 'tracked.txt'), 'utf8')).toBe('v1\n');
    await expect(fs.access(path.join(workspace, 'untracked.txt'))).rejects.toThrow();
  });

  it('captures untracked file at run start and deletes it on restore', async () => {
    if (!(await gitAvailable())) return;
    await git(['init', '-q']);
    await git(['config', 'user.email', 't@t.t']);
    await git(['config', 'user.name', 'T']);
    await fs.writeFile(path.join(workspace, 'tracked.txt'), 'base\n');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'init']);

    // An untracked file already exists at run start.
    await fs.writeFile(path.join(workspace, 'scratch.txt'), 'existing-untracked');

    const checkpointId = await createRunCheckpoint({ runId: 'run2', workspaceRoot: workspace }, db);
    const cp = getCheckpoint(checkpointId!, db)!;
    const entries = getCheckpointEntries(cp.id, db);
    expect(entries.some((e) => e.relPath === 'scratch.txt')).toBe(true);

    // Run modifies it; restore should write the captured pre-image back.
    await fs.writeFile(path.join(workspace, 'scratch.txt'), 'changed');
    await restoreCheckpoint(cp.id, db);
    expect(await fs.readFile(path.join(workspace, 'scratch.txt'), 'utf8')).toBe(
      'existing-untracked',
    );
  });
});

describe('createRunCheckpoint — non-repo content blobs', () => {
  it('captures + restores workspace files for a non-git workspace', async () => {
    await fs.writeFile(path.join(workspace, 'f1.txt'), 'one');
    await fs.mkdir(path.join(workspace, 'sub'));
    await fs.writeFile(path.join(workspace, 'sub', 'f2.txt'), 'two');

    const checkpointId = await createRunCheckpoint({ runId: 'run3', workspaceRoot: workspace }, db);
    expect(checkpointId).not.toBeNull();
    const cp = getCheckpoint(checkpointId!, db)!;
    expect(cp.kind).toBe('content');
    expect(listCheckpointsForRun('run3', db)).toHaveLength(1);

    await fs.writeFile(path.join(workspace, 'f1.txt'), 'one-mutated');
    await fs.writeFile(path.join(workspace, 'sub', 'f2.txt'), 'two-mutated');

    await restoreCheckpoint(cp.id, db);
    expect(await fs.readFile(path.join(workspace, 'f1.txt'), 'utf8')).toBe('one');
    expect(await fs.readFile(path.join(workspace, 'sub', 'f2.txt'), 'utf8')).toBe('two');
  });
});

describe('IPC sink behavior', () => {
  it('restoreCheckpoint rejects an unknown checkpointId', async () => {
    await expect(restoreCheckpoint('does-not-exist', db)).rejects.toThrow(/Unknown checkpoint/);
  });

  it('listCheckpointsForMessage returns the active turn checkpoint', async () => {
    await fs.writeFile(path.join(workspace, 'm.txt'), 'x');
    await capture('msgX', 'write_file', 'm.txt');
    const list = listCheckpointsForMessage('msgX', db);
    expect(list).toHaveLength(1);
    expect(list[0]?.scope).toBe('turn');
  });
});

it('blobsDir override is honored', () => {
  expect(blobsDir()).toBe(blobs);
});
