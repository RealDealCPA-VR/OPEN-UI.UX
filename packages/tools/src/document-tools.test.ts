import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDocumentTool } from './read-document';
import { writeDocumentTool } from './write-document';
import { PathEscapesWorkspaceError } from './path-guard';
import { createTmpWorkspace, makeCtx, type TmpWorkspace } from './test-helpers';

describe('document tools', () => {
  let ws: TmpWorkspace;

  beforeEach(async () => {
    ws = await createTmpWorkspace({});
  });

  afterEach(async () => {
    await ws.cleanup();
  });

  it('round-trips Markdown as plain text', async () => {
    await writeDocumentTool.execute(
      { path: 'notes.md', content: '# Title\n\nbody text' },
      makeCtx(ws.root),
    );
    const read = await readDocumentTool.execute({ path: 'notes.md' }, makeCtx(ws.root));
    expect(read.format).toBe('text');
    expect(read.content).toContain('# Title');
    expect(read.content).toContain('body text');
  });

  it('round-trips Excel (.xlsx) via CSV', async () => {
    const csv = 'name,score\nAlice,10\nBob,20';
    const written = await writeDocumentTool.execute(
      { path: 'data.xlsx', content: csv },
      makeCtx(ws.root),
    );
    expect(written.format).toBe('xlsx');
    expect(written.bytesWritten).toBeGreaterThan(0);

    const read = await readDocumentTool.execute({ path: 'data.xlsx' }, makeCtx(ws.root));
    expect(read.format).toBe('xlsx');
    expect(read.sheets?.length ?? 0).toBeGreaterThan(0);
    expect(read.content).toContain('Alice');
    expect(read.content).toContain('20');
  });

  it('round-trips Word (.docx)', async () => {
    const body = 'Hello from a generated Word document.';
    const written = await writeDocumentTool.execute(
      { path: 'doc.docx', content: body },
      makeCtx(ws.root),
    );
    expect(written.format).toBe('docx');
    expect(written.bytesWritten).toBeGreaterThan(0);

    const read = await readDocumentTool.execute({ path: 'doc.docx' }, makeCtx(ws.root));
    expect(read.format).toBe('docx');
    expect(read.content).toContain('Hello from a generated Word document');
  });

  it('round-trips PDF text', async () => {
    const body = 'The quick brown fox jumps over the lazy dog.';
    const written = await writeDocumentTool.execute(
      { path: 'doc.pdf', content: body },
      makeCtx(ws.root),
    );
    expect(written.format).toBe('pdf');
    expect(written.bytesWritten).toBeGreaterThan(0);

    const read = await readDocumentTool.execute({ path: 'doc.pdf' }, makeCtx(ws.root));
    expect(read.format).toBe('pdf');
    expect(read.pages).toBe(1);
    // pdfjs text extraction can shift whitespace; assert key words survive.
    expect(read.content).toContain('quick');
    expect(read.content).toContain('lazy');
  });

  it('sanitizes non-Latin-1 characters when generating a PDF', async () => {
    // Smart quotes / em-dash would otherwise make pdf-lib throw.
    const written = await writeDocumentTool.execute(
      { path: 'fancy.pdf', content: '“Hello” — world’s test' },
      makeCtx(ws.root),
    );
    expect(written.format).toBe('pdf');
    expect(written.bytesWritten).toBeGreaterThan(0);
  });

  it('truncates extracted text with maxChars', async () => {
    await writeDocumentTool.execute({ path: 'long.txt', content: 'abcdefghij' }, makeCtx(ws.root));
    const read = await readDocumentTool.execute(
      { path: 'long.txt', maxChars: 4 },
      makeCtx(ws.root),
    );
    expect(read.content).toBe('abcd');
    expect(read.truncated).toBe(true);
  });

  it('refuses paths that escape the workspace', async () => {
    await expect(
      writeDocumentTool.execute({ path: '../escape.pdf', content: 'x' }, makeCtx(ws.root)),
    ).rejects.toBeInstanceOf(PathEscapesWorkspaceError);
    await expect(
      readDocumentTool.execute({ path: '../escape.pdf' }, makeCtx(ws.root)),
    ).rejects.toBeInstanceOf(PathEscapesWorkspaceError);
  });
});
