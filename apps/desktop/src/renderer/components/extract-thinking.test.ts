import { describe, expect, it } from 'vitest';
import { hasThinking, splitThinkingSegments } from './extract-thinking';

describe('splitThinkingSegments', () => {
  it('returns a single text segment when there is no thinking', () => {
    expect(splitThinkingSegments('just a normal reply')).toEqual([
      { kind: 'text', text: 'just a normal reply' },
    ]);
  });

  it('extracts a closed <think> block surrounded by text', () => {
    expect(splitThinkingSegments('before<think>reasoning</think>after')).toEqual([
      { kind: 'text', text: 'before' },
      { kind: 'think', text: 'reasoning' },
      { kind: 'text', text: 'after' },
    ]);
  });

  it('treats an unclosed (streaming) opening tag as thinking to the end', () => {
    expect(splitThinkingSegments('hmm <think>still working')).toEqual([
      { kind: 'text', text: 'hmm ' },
      { kind: 'think', text: 'still working' },
    ]);
  });

  it('is case-insensitive and supports <thinking> and <reasoning>', () => {
    expect(splitThinkingSegments('<Thinking>a</Thinking>x<REASONING>b</REASONING>')).toEqual([
      { kind: 'think', text: 'a' },
      { kind: 'text', text: 'x' },
      { kind: 'think', text: 'b' },
    ]);
  });

  it('handles multiple think blocks', () => {
    expect(splitThinkingSegments('<think>one</think>mid<think>two</think>end')).toEqual([
      { kind: 'think', text: 'one' },
      { kind: 'text', text: 'mid' },
      { kind: 'think', text: 'two' },
      { kind: 'text', text: 'end' },
    ]);
  });

  it('drops whitespace-only text segments left around tags', () => {
    expect(splitThinkingSegments('<think>r</think>\n\n')).toEqual([{ kind: 'think', text: 'r' }]);
  });

  it('keeps an empty thinking segment when a block just opened', () => {
    expect(splitThinkingSegments('<think>')).toEqual([{ kind: 'think', text: '' }]);
  });
});

describe('hasThinking', () => {
  it('detects any thinking tag', () => {
    expect(hasThinking('a <think>b')).toBe(true);
    expect(hasThinking('<REASONING>')).toBe(true);
    expect(hasThinking('no tags here')).toBe(false);
  });
});
