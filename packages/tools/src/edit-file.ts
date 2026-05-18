import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { defineTool } from '@opencodex/core';
import { atomicWrite } from './atomic-write';
import { resolveWithinWorkspace } from './path-guard';

const input = z.object({
  path: z.string().describe('Workspace-relative or absolute path inside the workspace'),
  oldString: z.string().min(1).describe('Exact substring to replace. Must be non-empty.'),
  newString: z.string().describe('Replacement substring. May be empty.'),
  replaceAll: z
    .boolean()
    .optional()
    .describe('Replace every occurrence. Default false — requires a single unique match.'),
});

export interface EditFileResult {
  replacements: number;
}

export class OldStringNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`edit_file: oldString not found in "${path}"`);
    this.name = 'OldStringNotFoundError';
  }
}

export class EditFileAmbiguousError extends Error {
  constructor(
    public readonly path: string,
    public readonly occurrences: number,
  ) {
    super(
      `edit_file: oldString matches ${occurrences} times in "${path}". Set replaceAll: true to replace all, or provide a more specific oldString.`,
    );
    this.name = 'EditFileAmbiguousError';
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function replaceFirst(haystack: string, needle: string, replacement: string): string {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return haystack;
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

function replaceAllOccurrences(haystack: string, needle: string, replacement: string): string {
  return haystack.split(needle).join(replacement);
}

export const editFileTool = defineTool({
  name: 'edit_file',
  description:
    'Replace exact substring(s) in a workspace file. Requires a single unique match unless replaceAll is true.',
  inputZod: input,
  permissionTier: 'write',
  async execute(
    { path: requested, oldString, newString, replaceAll },
    ctx,
  ): Promise<EditFileResult> {
    const resolved = resolveWithinWorkspace(ctx.workspaceRoot, requested);
    ctx.signal.throwIfAborted();
    const original = await fs.readFile(resolved, 'utf8');
    const occurrences = countOccurrences(original, oldString);
    if (occurrences === 0) throw new OldStringNotFoundError(requested);
    if (occurrences > 1 && !replaceAll) {
      throw new EditFileAmbiguousError(requested, occurrences);
    }
    const next = replaceAll
      ? replaceAllOccurrences(original, oldString, newString)
      : replaceFirst(original, oldString, newString);
    const replacements = replaceAll ? occurrences : 1;
    await atomicWrite(resolved, next, ctx.signal);
    return { replacements };
  },
});
