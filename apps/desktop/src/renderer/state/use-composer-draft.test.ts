// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ChatAttachment } from '../../shared/attachments';
import {
  draftStorageKey,
  parseStoredDraft,
  serializeDraft,
  useComposerDraft,
} from './use-composer-draft';

function textAttachment(path: string): ChatAttachment {
  return {
    kind: 'text',
    name: path.split(/[\\/]/).pop() ?? path,
    path,
    mimeType: 'text/plain',
    text: 'hi',
    truncated: false,
    sizeBytes: 2,
  };
}

interface AttachmentsBridge {
  prepare: Mock;
}

function installBridge(prepare: Mock): void {
  (window as unknown as { opencodex: { attachments: AttachmentsBridge } }).opencodex = {
    attachments: { prepare },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  if (vi.isFakeTimers()) {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  }
  cleanup();
  delete (window as unknown as { opencodex?: unknown }).opencodex;
});

describe('use-composer-draft pure helpers', () => {
  it('draftStorageKey namespaces by conversation id', () => {
    expect(draftStorageKey('abc')).toBe('opencodex:composer-draft:abc');
  });

  it('serializeDraft writes v:1 + text + attachmentPaths and round-trips', () => {
    const raw = serializeDraft('hello', ['/a.txt']);
    const parsed = parseStoredDraft(raw);
    expect(parsed?.v).toBe(1);
    expect(parsed?.text).toBe('hello');
    expect(parsed?.attachmentPaths).toEqual(['/a.txt']);
    expect(typeof parsed?.updatedAt).toBe('number');
  });

  it('serialized payload contains only text + paths (no image data)', () => {
    const raw = serializeDraft('hi', ['/a.png']);
    expect(raw).not.toContain('data');
    const json = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(['attachmentPaths', 'text', 'updatedAt', 'v']);
  });

  it('parseStoredDraft rejects malformed / wrong-version JSON', () => {
    expect(parseStoredDraft(null)).toBeNull();
    expect(parseStoredDraft('not json')).toBeNull();
    expect(parseStoredDraft(JSON.stringify({ v: 2, text: 'x', attachmentPaths: [] }))).toBeNull();
    expect(parseStoredDraft(JSON.stringify({ v: 1, text: 5 }))).toBeNull();
  });
});

describe('useComposerDraft behavior', () => {
  it('persists text to localStorage after the debounce', () => {
    installBridge(vi.fn());
    const { result } = renderHook(() => useComposerDraft('c1'));
    act(() => result.current.setInput('draft text'));
    expect(window.localStorage.getItem(draftStorageKey('c1'))).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const parsed = parseStoredDraft(window.localStorage.getItem(draftStorageKey('c1')));
    expect(parsed?.text).toBe('draft text');
  });

  it('restores text on mount for the conversation', () => {
    installBridge(vi.fn());
    window.localStorage.setItem(draftStorageKey('c2'), serializeDraft('remembered', []));
    const { result } = renderHook(() => useComposerDraft('c2'));
    expect(result.current.input).toBe('remembered');
  });

  it('keeps A draft and shows B empty when switching A -> B -> A', () => {
    installBridge(vi.fn());
    window.localStorage.setItem(draftStorageKey('A'), serializeDraft('A text', []));
    const { result, rerender } = renderHook(({ id }) => useComposerDraft(id), {
      initialProps: { id: 'A' as string | null },
    });
    expect(result.current.input).toBe('A text');
    rerender({ id: 'B' });
    expect(result.current.input).toBe('');
    rerender({ id: 'A' });
    expect(result.current.input).toBe('A text');
  });

  it('re-prepares attachments from stored paths via the bridge', async () => {
    vi.useRealTimers();
    const prepare = vi.fn(() =>
      Promise.resolve({ prepared: [textAttachment('/x.txt')], errors: [] }),
    );
    installBridge(prepare);
    window.localStorage.setItem(draftStorageKey('c3'), serializeDraft('', ['/x.txt']));
    const { result } = renderHook(() => useComposerDraft('c3'));
    await waitFor(() => expect(result.current.attachments.length).toBe(1));
    expect(prepare).toHaveBeenCalledWith({ paths: ['/x.txt'] });
    expect(result.current.attachments[0]?.path).toBe('/x.txt');
  });

  it('silently drops attachments when the bridge returns none (missing file)', async () => {
    vi.useRealTimers();
    const prepare = vi.fn(() => Promise.resolve({ prepared: [], errors: [] }));
    installBridge(prepare);
    window.localStorage.setItem(draftStorageKey('c4'), serializeDraft('keep', ['/gone.txt']));
    const { result } = renderHook(() => useComposerDraft('c4'));
    await waitFor(() => expect(prepare).toHaveBeenCalled());
    expect(result.current.attachments).toEqual([]);
    expect(result.current.input).toBe('keep');
  });

  it('clear() empties the composer and removes the persisted draft', () => {
    installBridge(vi.fn());
    window.localStorage.setItem(draftStorageKey('c5'), serializeDraft('text', []));
    const { result } = renderHook(() => useComposerDraft('c5'));
    act(() => result.current.clear());
    expect(result.current.input).toBe('');
    expect(window.localStorage.getItem(draftStorageKey('c5'))).toBeNull();
  });

  it('persists only text + paths, never base64 image data', () => {
    installBridge(vi.fn());
    const image: ChatAttachment = {
      kind: 'image',
      name: 'p.png',
      path: '/p.png',
      mimeType: 'image/png',
      data: 'AAAABASE64AAAA',
      sizeBytes: 10,
    };
    const { result } = renderHook(() => useComposerDraft('c6'));
    act(() => {
      result.current.setInput('look');
      result.current.setAttachments([image]);
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const raw = window.localStorage.getItem(draftStorageKey('c6')) ?? '';
    expect(raw).not.toContain('AAAABASE64AAAA');
    expect(parseStoredDraft(raw)?.attachmentPaths).toEqual(['/p.png']);
  });

  it('degrades gracefully when localStorage throws on write', () => {
    installBridge(vi.fn());
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() => useComposerDraft('c7'));
    expect(() => {
      act(() => result.current.setInput('x'));
      act(() => {
        vi.advanceTimersByTime(400);
      });
    }).not.toThrow();
    setItem.mockRestore();
  });
});
