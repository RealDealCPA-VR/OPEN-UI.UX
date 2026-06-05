import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { ChatAttachment } from '../../shared/attachments';

const DRAFT_VERSION = 1;
const PERSIST_DEBOUNCE_MS = 400;
const KEY_PREFIX = 'opencodex:composer-draft:';

const storedDraftSchema = z.object({
  v: z.literal(DRAFT_VERSION),
  text: z.string(),
  attachmentPaths: z.array(z.string()),
  updatedAt: z.number(),
});

export type StoredDraft = z.infer<typeof storedDraftSchema>;

export function draftStorageKey(conversationId: string): string {
  return `${KEY_PREFIX}${conversationId}`;
}

function getLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function parseStoredDraft(raw: string | null): StoredDraft | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = storedDraftSchema.safeParse(json);
  return result.success ? result.data : null;
}

export function serializeDraft(text: string, attachmentPaths: string[]): string {
  const draft: StoredDraft = {
    v: DRAFT_VERSION,
    text,
    attachmentPaths,
    updatedAt: Date.now(),
  };
  return JSON.stringify(draft);
}

function readDraft(conversationId: string): StoredDraft | null {
  const store = getLocalStorage();
  if (!store) return null;
  try {
    return parseStoredDraft(store.getItem(draftStorageKey(conversationId)));
  } catch {
    return null;
  }
}

function writeDraft(conversationId: string, text: string, attachmentPaths: string[]): void {
  const store = getLocalStorage();
  if (!store) return;
  try {
    if (text.length === 0 && attachmentPaths.length === 0) {
      store.removeItem(draftStorageKey(conversationId));
      return;
    }
    store.setItem(draftStorageKey(conversationId), serializeDraft(text, attachmentPaths));
  } catch {
    // localStorage may throw on quota/private mode — drafts are best-effort.
  }
}

function removeDraft(conversationId: string): void {
  const store = getLocalStorage();
  if (!store) return;
  try {
    store.removeItem(draftStorageKey(conversationId));
  } catch {
    // ignore
  }
}

export interface ComposerDraft {
  input: string;
  setInput: (value: string | ((prev: string) => string)) => void;
  attachments: ChatAttachment[];
  setAttachments: (
    value: ChatAttachment[] | ((prev: ChatAttachment[]) => ChatAttachment[]),
  ) => void;
  clear: () => void;
}

export function useComposerDraft(conversationId: string | null): ComposerDraft {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const debounceRef = useRef<number | null>(null);
  // Suppress the persist-on-change effect for the synchronous restore that
  // happens when the conversation id flips, so we never echo a freshly-read
  // draft straight back into storage with a new timestamp.
  const restoringRef = useRef(false);

  // Restore the persisted draft whenever the active conversation changes; this
  // is genuine external→React synchronization, hence the eslint suppressions.
  useEffect(() => {
    restoringRef.current = true;
    if (!conversationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInput('');
      setAttachments([]);
      restoringRef.current = false;
      return;
    }
    const stored = readDraft(conversationId);
    setInput(stored?.text ?? '');
    setAttachments([]);
    if (stored && stored.attachmentPaths.length > 0) {
      let cancelled = false;
      void window.opencodex.attachments
        .prepare({ paths: stored.attachmentPaths })
        .then((res) => {
          if (!cancelled && res.prepared.length > 0) {
            setAttachments(res.prepared);
          }
        })
        .catch(() => {
          // Missing/unreadable files are dropped silently.
        });
      restoringRef.current = false;
      return () => {
        cancelled = true;
      };
    }
    restoringRef.current = false;
    return undefined;
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return undefined;
    if (restoringRef.current) return undefined;
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    const paths = attachments.map((a) => a.path);
    const text = input;
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      writeDraft(conversationId, text, paths);
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [conversationId, input, attachments]);

  const clear = useCallback((): void => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setInput('');
    setAttachments([]);
    if (conversationId) removeDraft(conversationId);
  }, [conversationId]);

  return { input, setInput, attachments, setAttachments, clear };
}
