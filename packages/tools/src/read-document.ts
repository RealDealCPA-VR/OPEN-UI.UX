import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { defineTool } from '@opencodex/core';
import { documentFormat, type DocumentFormat } from './document-format';
import { resolveWithinWorkspace } from './path-guard';

const input = z.object({
  path: z.string().describe('Workspace-relative or absolute path inside the workspace'),
  maxChars: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Truncate the extracted text to at most this many characters'),
});

export interface ReadDocumentResult {
  content: string;
  format: DocumentFormat;
  chars: number;
  truncated: boolean;
  pages?: number;
  sheets?: string[];
}

async function extractPdf(data: Uint8Array): Promise<{ text: string; pages: number }> {
  // unpdf bundles a serverless pdfjs build (no native canvas), so text
  // extraction needs no native modules.
  const { extractText } = await import('unpdf');
  // unpdf rejects a Node Buffer (it would take ownership of the pooled memory),
  // so hand it a standalone Uint8Array copy.
  const bytes = new Uint8Array(data);
  const { totalPages, text } = await extractText(bytes, { mergePages: true });
  return { text, pages: totalPages };
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

async function extractSpreadsheet(data: Buffer): Promise<{ text: string; sheets: string[] }> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(data, { type: 'buffer' });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    parts.push(`# Sheet: ${name}\n${XLSX.utils.sheet_to_csv(sheet)}`);
  }
  return { text: parts.join('\n\n'), sheets: wb.SheetNames };
}

export const readDocumentTool = defineTool({
  name: 'read_document',
  description:
    'Read and extract text from a document. Supports PDF, Word (.docx), Excel (.xlsx/.xls), CSV, ' +
    'Markdown, and plain text. PDF/Word return extracted text; spreadsheets return CSV per sheet. ' +
    'For source code use read_file instead.',
  inputZod: input,
  permissionTier: 'read',
  async execute({ path: requested, maxChars }, ctx): Promise<ReadDocumentResult> {
    const resolved = await resolveWithinWorkspace(ctx.workspaceRoot, requested);
    ctx.signal.throwIfAborted();
    const format = documentFormat(resolved);

    let text: string;
    let pages: number | undefined;
    let sheets: string[] | undefined;

    if (format === 'pdf') {
      const buffer = await fs.readFile(resolved);
      ctx.signal.throwIfAborted();
      const out = await extractPdf(buffer);
      text = out.text;
      pages = out.pages;
    } else if (format === 'docx') {
      const buffer = await fs.readFile(resolved);
      ctx.signal.throwIfAborted();
      text = await extractDocx(buffer);
    } else if (format === 'xlsx') {
      const buffer = await fs.readFile(resolved);
      ctx.signal.throwIfAborted();
      const out = await extractSpreadsheet(buffer);
      text = out.text;
      sheets = out.sheets;
    } else {
      // csv + text: already UTF-8, read directly.
      text = await fs.readFile(resolved, 'utf8');
    }

    const truncated = maxChars !== undefined && text.length > maxChars;
    const content = truncated ? text.slice(0, maxChars) : text;
    return {
      content,
      format,
      chars: content.length,
      truncated,
      ...(pages !== undefined ? { pages } : {}),
      ...(sheets !== undefined ? { sheets } : {}),
    };
  },
});
