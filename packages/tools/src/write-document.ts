import { z } from 'zod';
import { defineTool } from '@opencodex/core';
import { atomicWrite } from './atomic-write';
import { documentFormat, type DocumentFormat } from './document-format';
import { resolveWithinWorkspace } from './path-guard';

const input = z.object({
  path: z.string().describe('Workspace-relative or absolute path inside the workspace'),
  content: z
    .string()
    .describe(
      'The document body. For .pdf/.docx/.md/.txt this is plain text (one line per source line, ' +
        'blank line between paragraphs). For .xlsx/.xls/.csv this is CSV — one row per line, ' +
        'comma-separated.',
    ),
});

export interface WriteDocumentResult {
  bytesWritten: number;
  format: DocumentFormat;
  path: string;
}

// StandardFonts use WinAnsi (Latin-1); map the common typographic characters
// and drop anything else so generation never throws on an unencodable glyph.
function toLatin1(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[Ā-￿]/g, '');
}

async function generatePdf(text: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = 11;
  const lineHeight = fontSize * 1.45;
  const margin = 56;
  const pageWidth = 612;
  const pageHeight = 792;
  const maxWidth = pageWidth - margin * 2;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const wrap = (paragraph: string): string[] => {
    if (paragraph.length === 0) return [''];
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) return [''];
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  for (const paragraph of toLatin1(text).split(/\r?\n/)) {
    for (const line of wrap(paragraph)) {
      if (y < margin) {
        page = doc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
      y -= lineHeight;
    }
  }
  return doc.save();
}

async function generateDocx(text: string): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, TextRun } = await import('docx');
  const paragraphs = text
    .split(/\r?\n/)
    .map((line) => new Paragraph({ children: [new TextRun(line)] }));
  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBuffer(doc);
}

async function generateSpreadsheet(csv: string, bookType: 'xlsx' | 'xls'): Promise<Uint8Array> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(csv, { type: 'string' });
  return XLSX.write(wb, { type: 'buffer', bookType }) as Uint8Array;
}

export const writeDocumentTool = defineTool({
  name: 'write_document',
  description:
    'Create a document from text. Supports PDF, Word (.docx), Excel (.xlsx/.xls), CSV, Markdown, ' +
    'and plain text, chosen by the file extension. PDF/Word are generated from plain text; ' +
    'spreadsheets are generated from CSV content. Overwrites if the file exists.',
  inputZod: input,
  permissionTier: 'write',
  async execute({ path: requested, content }, ctx): Promise<WriteDocumentResult> {
    const resolved = await resolveWithinWorkspace(ctx.workspaceRoot, requested);
    ctx.signal.throwIfAborted();
    const format = documentFormat(resolved);

    let payload: string | Uint8Array;
    if (format === 'pdf') {
      payload = await generatePdf(content);
    } else if (format === 'docx') {
      payload = await generateDocx(content);
    } else if (format === 'xlsx') {
      payload = await generateSpreadsheet(
        content,
        resolved.toLowerCase().endsWith('.xls') ? 'xls' : 'xlsx',
      );
    } else {
      // csv + text/markdown: write the content verbatim.
      payload = content;
    }

    ctx.signal.throwIfAborted();
    await atomicWrite(resolved, payload, ctx.signal);
    return {
      bytesWritten:
        typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : payload.byteLength,
      format,
      path: resolved,
    };
  },
});
