import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';
import { resolveWithinWorkspace, PathEscapesWorkspaceError } from '@opencodex/tools';
import type {
  Checkpoint,
  CheckpointEntry,
  RestoreCheckpointResponse,
  RestoreSkippedEntry,
} from '../../shared/checkpoints';
import { logger } from '../logger';
import { getDb } from '../storage/db';
import {
  addCheckpointEntry,
  countCheckpointEntries,
  createCheckpoint,
  deleteCheckpoint,
  findActiveTurnCheckpoint,
  getCheckpoint,
  getCheckpointEntries,
  hasEntryForPath,
  listAllCheckpoints,
  setCheckpointStatus,
} from '../storage/checkpoints';
import { getBlob, gcOrphanBlobs, putBlob } from './blob-store';

const execFileAsync = promisify(execFile);

// Per-file cap: pre-images larger than this are recorded with status too_large
// (pre_blob_sha = null, marked via a sentinel) and EXCLUDED from restore.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Retention knobs for gc().
const RETENTION_MAX_COUNT = 200;
const RETENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RETENTION_MAX_TOTAL_BYTES = 512 * 1024 * 1024;

// Sentinel sha for "we deliberately skipped capturing this pre-image because it
// exceeded MAX_FILE_BYTES". Restore treats it like a path that must be skipped.
const TOO_LARGE_SENTINEL = 'too_large';

const MUTATING_TOOLS = new Set(['write_file', 'edit_file', 'write_document']);

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

function extractPathArg(args: unknown): string | null {
  if (typeof args !== 'object' || args === null) return null;
  const p = (args as Record<string, unknown>).path;
  return typeof p === 'string' && p.length > 0 ? p : null;
}

export interface CaptureBeforeMutationInput {
  scope: 'turn';
  conversationId: string;
  assistantMessageId: string;
  workspaceRoot: string;
  toolName: string;
  args: unknown;
}

/**
 * Per-turn pre-image capture. Invoked immediately BEFORE registry.execute for
 * every tool call. Decides whether the tool mutates; for mutating tools it
 * snapshots the target file's current bytes (the pre-image) into the turn
 * checkpoint, deduping by rel_path (first pre-image wins). Non-mutating tools
 * and run_shell are no-ops. Capture failure is logged and swallowed — it must
 * never block the edit.
 */
export async function captureBeforeMutation(
  input: CaptureBeforeMutationInput,
  db: Database.Database = getDb(),
): Promise<void> {
  try {
    if (!isMutatingTool(input.toolName)) return;
    const requested = extractPathArg(input.args);
    if (!requested) return;

    // Re-validate at the sink: the recorded path MUST resolve within the
    // workspace. An escaping path is not captured (and won't be restorable).
    let resolved: string;
    try {
      resolved = await resolveWithinWorkspace(input.workspaceRoot, requested);
    } catch (err) {
      logger.warn(
        { err, tool: input.toolName, requested },
        'checkpoint capture: path escapes workspace — skipping',
      );
      return;
    }

    const relPath = toRelPath(input.workspaceRoot, resolved);

    // Lazy turn checkpoint — created on the first mutating tool of the turn.
    let checkpoint = findActiveTurnCheckpoint(input.assistantMessageId, db);
    if (!checkpoint) {
      const id = createCheckpoint(
        {
          scope: 'turn',
          conversationId: input.conversationId,
          messageId: input.assistantMessageId,
          workspaceRoot: input.workspaceRoot,
          kind: 'content',
          label: 'Before this turn',
        },
        db,
      );
      checkpoint = getCheckpoint(id, db);
      if (!checkpoint) return;
    }

    // Dedup within the turn — first pre-image of a path wins.
    if (hasEntryForPath(checkpoint.id, relPath, db)) return;

    // Read current bytes. ENOENT → file is absent → pre_blob_sha=null means
    // "restore should delete this newly-created file".
    let bytes: Buffer | null = null;
    try {
      bytes = await fs.readFile(resolved);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        addCheckpointEntry(
          { checkpointId: checkpoint.id, relPath, preBlobSha: null, preSize: 0 },
          db,
        );
        return;
      }
      throw err;
    }

    if (bytes.byteLength > MAX_FILE_BYTES) {
      // Too large to checkpoint: record the path so restore can REPORT it as
      // skipped, but store no blob and exclude it from the write-back.
      addCheckpointEntry(
        {
          checkpointId: checkpoint.id,
          relPath,
          preBlobSha: TOO_LARGE_SENTINEL,
          preSize: bytes.byteLength,
        },
        db,
      );
      return;
    }

    const sha = await putBlob(bytes);
    addCheckpointEntry(
      { checkpointId: checkpoint.id, relPath, preBlobSha: sha, preSize: bytes.byteLength },
      db,
    );
  } catch (err) {
    // Capture must never block the edit. Mark the turn non-restorable by
    // superseding its active checkpoint (so the UI won't offer a partial,
    // misleading restore) and continue.
    logger.error(
      { err, tool: input.toolName, messageId: input.assistantMessageId },
      'checkpoint capture failed — marking turn non-restorable, continuing',
    );
    try {
      const cp = findActiveTurnCheckpoint(input.assistantMessageId, db);
      if (cp) setCheckpointStatus(cp.id, 'superseded', db);
    } catch {
      // best-effort
    }
  }
}

export interface CreateRunCheckpointInput {
  runId: string;
  workspaceRoot: string;
  conversationId?: string | null;
}

async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', [...args], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return { stdout, stderr };
}

async function isGitRepo(p: string): Promise<boolean> {
  try {
    const { stdout } = await runGit(p, ['rev-parse', '--is-inside-work-tree']);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Pre-run checkpoint for in-place (no worktree) runs.
 *  - git repos: record HEAD sha + `git stash create` ref (captures tracked
 *    working-tree changes without disturbing the index), PLUS content blobs for
 *    every untracked-but-not-ignored file so they can be deleted on restore.
 *  - non-repos: content blobs for every file under the workspace (bounded by
 *    the per-file cap).
 * Returns the new checkpoint id, or null if nothing could be captured.
 */
export async function createRunCheckpoint(
  input: CreateRunCheckpointInput,
  db: Database.Database = getDb(),
): Promise<string | null> {
  try {
    const repo = await isGitRepo(input.workspaceRoot);
    if (repo) {
      return await createGitRunCheckpoint(input, db);
    }
    return await createContentRunCheckpoint(input, db);
  } catch (err) {
    logger.error(
      { err, runId: input.runId },
      'createRunCheckpoint failed — run will be non-restorable',
    );
    return null;
  }
}

async function createGitRunCheckpoint(
  input: CreateRunCheckpointInput,
  db: Database.Database,
): Promise<string> {
  const { stdout: headOut } = await runGit(input.workspaceRoot, ['rev-parse', 'HEAD']);
  const baseSha = headOut.trim();

  let stashRef: string | null = null;
  try {
    const { stdout } = await runGit(input.workspaceRoot, ['stash', 'create', 'opencodex pre-run']);
    const ref = stdout.trim();
    stashRef = ref.length > 0 ? ref : null;
  } catch (err) {
    logger.warn(
      { err, runId: input.runId },
      'git stash create failed — tracked changes may not restore',
    );
  }

  const checkpointId = createCheckpoint(
    {
      scope: 'run',
      runId: input.runId,
      conversationId: input.conversationId ?? null,
      workspaceRoot: input.workspaceRoot,
      kind: 'git',
      gitBaseSha: baseSha,
      gitStashRef: stashRef,
      label: 'Before this run',
    },
    db,
  );

  // Untracked-but-not-ignored files: blob them so restore can delete them.
  try {
    const { stdout } = await runGit(input.workspaceRoot, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ]);
    const rels = stdout.split('\0').filter((s) => s.length > 0);
    for (const rel of rels) {
      await captureFileForCheckpoint(checkpointId, input.workspaceRoot, rel, db);
    }
  } catch (err) {
    logger.warn({ err, runId: input.runId }, 'git ls-files --others failed');
  }

  return checkpointId;
}

async function createContentRunCheckpoint(
  input: CreateRunCheckpointInput,
  db: Database.Database,
): Promise<string> {
  const checkpointId = createCheckpoint(
    {
      scope: 'run',
      runId: input.runId,
      conversationId: input.conversationId ?? null,
      workspaceRoot: input.workspaceRoot,
      kind: 'content',
      label: 'Before this run',
    },
    db,
  );

  const files = await walkFiles(input.workspaceRoot);
  for (const abs of files) {
    const rel = toRelPath(input.workspaceRoot, abs);
    await captureFileForCheckpoint(checkpointId, input.workspaceRoot, rel, db);
  }
  return checkpointId;
}

async function captureFileForCheckpoint(
  checkpointId: string,
  workspaceRoot: string,
  rel: string,
  db: Database.Database,
): Promise<void> {
  let resolved: string;
  try {
    resolved = await resolveWithinWorkspace(workspaceRoot, rel);
  } catch {
    return;
  }
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(resolved);
  } catch {
    return;
  }
  const relPath = toRelPath(workspaceRoot, resolved);
  if (bytes.byteLength > MAX_FILE_BYTES) {
    addCheckpointEntry(
      { checkpointId, relPath, preBlobSha: TOO_LARGE_SENTINEL, preSize: bytes.byteLength },
      db,
    );
    return;
  }
  const sha = await putBlob(bytes);
  addCheckpointEntry({ checkpointId, relPath, preBlobSha: sha, preSize: bytes.byteLength }, db);
}

const WALK_IGNORE = new Set(['.git', 'node_modules', '.opencodex']);

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function recur(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (WALK_IGNORE.has(entry.name)) continue;
        await recur(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }
  await recur(root);
  return out;
}

function toRelPath(workspaceRoot: string, absPath: string): string {
  const rel = path.relative(path.resolve(workspaceRoot), absPath);
  return rel.split(path.sep).join('/');
}

/**
 * Restore a checkpoint. Before writing anything, snapshot the CURRENT state of
 * every target path into a NEW superseding checkpoint so the restore is itself
 * undoable; that new checkpoint's id is returned. Then write pre-images back,
 * re-validating EVERY target path with resolveWithinWorkspace — escapes and
 * too_large entries are skipped + reported, NEVER written.
 */
export async function restoreCheckpoint(
  checkpointId: string,
  db: Database.Database = getDb(),
): Promise<RestoreCheckpointResponse> {
  const checkpoint = getCheckpoint(checkpointId, db);
  if (!checkpoint) {
    throw new Error(`Unknown checkpoint: ${checkpointId}`);
  }

  if (checkpoint.kind === 'git') {
    return restoreGitCheckpoint(checkpoint, db);
  }

  const entries = getCheckpointEntries(checkpointId, db);
  const skipped: RestoreSkippedEntry[] = [];

  // Snapshot current state first → undoable restore.
  const newCheckpointId = createCheckpoint(
    {
      scope: checkpoint.scope,
      conversationId: checkpoint.conversationId,
      messageId: checkpoint.messageId,
      runId: checkpoint.runId,
      workspaceRoot: checkpoint.workspaceRoot,
      kind: 'content',
      label: 'Before restore',
    },
    db,
  );

  let restoredCount = 0;
  let deletedCount = 0;

  for (const entry of entries) {
    if (entry.preBlobSha === TOO_LARGE_SENTINEL) {
      skipped.push({ relPath: entry.relPath, reason: 'too-large' });
      continue;
    }

    let resolved: string;
    try {
      resolved = await resolveWithinWorkspace(checkpoint.workspaceRoot, entry.relPath);
    } catch (err) {
      if (err instanceof PathEscapesWorkspaceError) {
        skipped.push({ relPath: entry.relPath, reason: 'path-escape' });
      } else {
        skipped.push({ relPath: entry.relPath, reason: 'error' });
      }
      continue;
    }

    // Snapshot current bytes of this target into the undo checkpoint.
    await snapshotCurrentInto(newCheckpointId, checkpoint.workspaceRoot, entry.relPath, db);

    try {
      if (entry.preBlobSha === null) {
        // Pre-image was "absent" → the file was newly created this turn →
        // delete it to restore the absent state.
        await fs.rm(resolved, { force: true });
        deletedCount++;
      } else {
        const blob = await getBlob(entry.preBlobSha);
        if (blob === null) {
          skipped.push({ relPath: entry.relPath, reason: 'error' });
          continue;
        }
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, blob);
        restoredCount++;
      }
    } catch (err) {
      logger.error({ err, relPath: entry.relPath }, 'checkpoint restore: write-back failed');
      skipped.push({ relPath: entry.relPath, reason: 'error' });
    }
  }

  setCheckpointStatus(checkpointId, 'restored', db);

  // Drop the undo checkpoint if it captured nothing (nothing was changed).
  if (countCheckpointEntries(newCheckpointId, db) === 0) {
    deleteCheckpoint(newCheckpointId, db);
    return { checkpointId, newCheckpointId: null, restoredCount, deletedCount, skipped };
  }

  return { checkpointId, newCheckpointId, restoredCount, deletedCount, skipped };
}

async function snapshotCurrentInto(
  checkpointId: string,
  workspaceRoot: string,
  relPath: string,
  db: Database.Database,
): Promise<void> {
  if (hasEntryForPath(checkpointId, relPath, db)) return;
  let resolved: string;
  try {
    resolved = await resolveWithinWorkspace(workspaceRoot, relPath);
  } catch {
    return;
  }
  let bytes: Buffer | null = null;
  try {
    bytes = await fs.readFile(resolved);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      addCheckpointEntry({ checkpointId, relPath, preBlobSha: null, preSize: 0 }, db);
      return;
    }
    return;
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    addCheckpointEntry(
      { checkpointId, relPath, preBlobSha: TOO_LARGE_SENTINEL, preSize: bytes.byteLength },
      db,
    );
    return;
  }
  const sha = await putBlob(bytes);
  addCheckpointEntry({ checkpointId, relPath, preBlobSha: sha, preSize: bytes.byteLength }, db);
}

async function restoreGitCheckpoint(
  checkpoint: Checkpoint,
  db: Database.Database,
): Promise<RestoreCheckpointResponse> {
  const skipped: RestoreSkippedEntry[] = [];
  const root = checkpoint.workspaceRoot;
  let restoredCount = 0;
  let deletedCount = 0;

  // Reset tracked files back to the recorded base, then re-apply the recorded
  // stash so the working tree matches the pre-run state exactly.
  if (checkpoint.gitBaseSha) {
    try {
      await runGit(root, ['reset', '--hard', checkpoint.gitBaseSha]);
      restoredCount++;
    } catch (err) {
      logger.error({ err, runId: checkpoint.runId }, 'git restore: reset --hard failed');
      skipped.push({ relPath: '<tracked>', reason: 'error' });
    }
  }
  if (checkpoint.gitStashRef) {
    try {
      await runGit(root, ['stash', 'apply', '--index', checkpoint.gitStashRef]);
    } catch {
      // --index can fail if the index state diverged; retry without it.
      try {
        await runGit(root, ['stash', 'apply', checkpoint.gitStashRef]);
      } catch (err2) {
        logger.warn({ err: err2, runId: checkpoint.runId }, 'git restore: stash apply failed');
        skipped.push({ relPath: '<stashed>', reason: 'error' });
      }
    }
  }

  const entries = getCheckpointEntries(checkpoint.id, db);

  // Delete untracked files the run created: anything currently untracked with
  // no entry for this checkpoint did not exist at capture time (entries are
  // only recorded for pre-run untracked files), so remove it to make the
  // working tree match the pre-run state.
  const preRunRelPaths = new Set(entries.map((e) => e.relPath));
  try {
    const { stdout } = await runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
    const currentUntracked = stdout.split('\0').filter((s) => s.length > 0);
    for (const relPath of currentUntracked) {
      if (preRunRelPaths.has(relPath)) continue;
      let resolved: string;
      try {
        resolved = await resolveWithinWorkspace(root, relPath);
      } catch (err) {
        skipped.push({
          relPath,
          reason: err instanceof PathEscapesWorkspaceError ? 'path-escape' : 'error',
        });
        continue;
      }
      try {
        await fs.rm(resolved, { force: true });
        deletedCount++;
      } catch (err) {
        logger.error({ err, relPath }, 'git restore: delete of run-created untracked file failed');
        skipped.push({ relPath, reason: 'error' });
      }
    }
  } catch (err) {
    logger.warn(
      { err, runId: checkpoint.runId },
      'git restore: ls-files --others failed — run-created untracked files not deleted',
    );
  }

  // Write back the blobbed pre-existing untracked files.
  for (const entry of entries) {
    if (entry.preBlobSha === TOO_LARGE_SENTINEL) {
      skipped.push({ relPath: entry.relPath, reason: 'too-large' });
      continue;
    }
    let resolved: string;
    try {
      resolved = await resolveWithinWorkspace(root, entry.relPath);
    } catch (err) {
      skipped.push({
        relPath: entry.relPath,
        reason: err instanceof PathEscapesWorkspaceError ? 'path-escape' : 'error',
      });
      continue;
    }
    try {
      if (entry.preBlobSha === null) {
        await fs.rm(resolved, { force: true });
        deletedCount++;
      } else {
        const blob = await getBlob(entry.preBlobSha);
        if (blob === null) {
          skipped.push({ relPath: entry.relPath, reason: 'error' });
          continue;
        }
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, blob);
        restoredCount++;
      }
    } catch (err) {
      logger.error({ err, relPath: entry.relPath }, 'git restore: untracked write-back failed');
      skipped.push({ relPath: entry.relPath, reason: 'error' });
    }
  }

  setCheckpointStatus(checkpoint.id, 'restored', db);
  return {
    checkpointId: checkpoint.id,
    newCheckpointId: null,
    restoredCount,
    deletedCount,
    skipped,
  };
}

export interface GcResult {
  deletedCheckpoints: number;
  removedBlobs: number;
}

/**
 * Retention GC: drop checkpoints exceeding the count cap, older than 7 days, or
 * pushing total stored bytes past 512MB; then refcount-GC orphaned blobs.
 * 'restored' checkpoints (the undo trail) and the newest checkpoints are kept
 * preferentially. Errors are swallowed — GC is best-effort.
 */
export async function gc(db: Database.Database = getDb()): Promise<GcResult> {
  let deletedCheckpoints = 0;
  try {
    const all = listAllCheckpoints(db); // newest first
    const now = Date.now();
    const toDelete = new Set<string>();

    // Age cap.
    for (const cp of all) {
      const created = Date.parse(cp.createdAt);
      if (!Number.isNaN(created) && now - created > RETENTION_MAX_AGE_MS) {
        toDelete.add(cp.id);
      }
    }

    // Count cap — keep the newest RETENTION_MAX_COUNT survivors.
    const survivors = all.filter((cp) => !toDelete.has(cp.id));
    if (survivors.length > RETENTION_MAX_COUNT) {
      for (const cp of survivors.slice(RETENTION_MAX_COUNT)) {
        toDelete.add(cp.id);
      }
    }

    // Total-bytes cap — accumulate over the kept set newest-first.
    let running = 0;
    for (const cp of all) {
      if (toDelete.has(cp.id)) continue;
      running += cp.totalBytes;
      if (running > RETENTION_MAX_TOTAL_BYTES) {
        toDelete.add(cp.id);
      }
    }

    for (const id of toDelete) {
      deleteCheckpoint(id, db);
      deletedCheckpoints++;
    }
  } catch (err) {
    logger.warn({ err }, 'checkpoint retention gc failed');
  }

  let removedBlobs = 0;
  try {
    removedBlobs = await gcOrphanBlobs(db);
  } catch (err) {
    logger.warn({ err }, 'checkpoint blob gc failed');
  }

  return { deletedCheckpoints, removedBlobs };
}

export type { Checkpoint, CheckpointEntry };
