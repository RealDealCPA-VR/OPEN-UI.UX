import { richTextSchema } from './schemas';

interface PartialBlock {
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

export function richTextToPlain(rt: unknown): string {
  const parsed = richTextSchema.safeParse(rt ?? []);
  if (!parsed.success) return '';
  return parsed.data.map((part) => part.plain_text ?? part.text?.content ?? '').join('');
}

export function renderBlockToMarkdown(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const block = raw as PartialBlock;
  const type = block.type;
  if (typeof type !== 'string') return '';
  const detail = (block as Record<string, unknown>)[type];
  const richText = (detail as { rich_text?: unknown } | undefined)?.rich_text;
  const text = richTextToPlain(richText);

  switch (type) {
    case 'paragraph':
      return text;
    case 'heading_1':
      return `# ${text}`;
    case 'heading_2':
      return `## ${text}`;
    case 'heading_3':
      return `### ${text}`;
    case 'bulleted_list_item':
      return `- ${text}`;
    case 'numbered_list_item':
      return `1. ${text}`;
    case 'to_do': {
      const checked = Boolean((detail as { checked?: unknown } | undefined)?.checked);
      return `- [${checked ? 'x' : ' '}] ${text}`;
    }
    case 'quote':
      return `> ${text}`;
    case 'code': {
      const language = (detail as { language?: string } | undefined)?.language ?? '';
      return `\`\`\`${language}\n${text}\n\`\`\``;
    }
    case 'divider':
      return '---';
    case 'callout':
      return `> ${text}`;
    default:
      return `[unsupported: ${type}]`;
  }
}

export function buildParagraphBlock(text: string): Record<string, unknown> {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: { content: text },
        },
      ],
    },
  };
}

export function buildHeadingBlock(text: string): Record<string, unknown> {
  return {
    object: 'block',
    type: 'heading_1',
    heading_1: {
      rich_text: [
        {
          type: 'text',
          text: { content: text },
        },
      ],
    },
  };
}
