export interface ThinkingSegment {
  kind: 'think' | 'text';
  text: string;
}

const OPEN_TAG_RE = /<(think|thinking|reasoning)>/i;

/**
 * Splits assistant text into ordered "thinking" vs normal segments.
 *
 * Several reasoning models OpenCodex can drive (DeepSeek-R1, QwQ, and other
 * local models via Ollama) emit their chain-of-thought inline wrapped in
 * `<think>`, `<thinking>`, or `<reasoning>` tags. We surface those as distinct,
 * collapsible blocks instead of dumping the reasoning into the reply.
 *
 * An unclosed opening tag (i.e. mid-stream, before the closing tag has arrived)
 * makes the remainder a thinking segment, so the reasoning collapses live as it
 * streams rather than flashing as plain text.
 */
export function splitThinkingSegments(input: string): ThinkingSegment[] {
  const segments: ThinkingSegment[] = [];
  let rest = input;

  while (rest.length > 0) {
    const open = OPEN_TAG_RE.exec(rest);
    const tag = open?.[1];
    if (!open || open.index === undefined || tag === undefined) {
      segments.push({ kind: 'text', text: rest });
      break;
    }

    if (open.index > 0) {
      segments.push({ kind: 'text', text: rest.slice(0, open.index) });
    }

    const afterOpen = rest.slice(open.index + open[0].length);
    const closeRe = new RegExp(`</${tag}>`, 'i');
    const close = closeRe.exec(afterOpen);

    if (!close || close.index === undefined) {
      segments.push({ kind: 'think', text: afterOpen });
      break;
    }

    segments.push({ kind: 'think', text: afterOpen.slice(0, close.index) });
    rest = afterOpen.slice(close.index + close[0].length);
  }

  // Drop whitespace-only normal segments left behind around the tags; keep
  // thinking segments even when empty so the header still renders while a
  // freshly-opened block streams.
  return segments.filter((s) => s.kind === 'think' || s.text.trim().length > 0);
}

export function hasThinking(input: string): boolean {
  return OPEN_TAG_RE.test(input);
}
