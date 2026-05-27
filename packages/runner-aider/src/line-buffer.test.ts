import { describe, expect, it } from 'vitest';
import { LineBuffer } from './line-buffer';

describe('LineBuffer', () => {
  it('splits multi-line chunks into individual lines', () => {
    const buf = new LineBuffer();
    expect(buf.push('a\nb\nc\n')).toEqual(['a', 'b', 'c']);
  });

  it('buffers partial lines until a newline arrives', () => {
    const buf = new LineBuffer();
    expect(buf.push('hel')).toEqual([]);
    expect(buf.push('lo\nwor')).toEqual(['hello']);
    expect(buf.push('ld\n')).toEqual(['world']);
  });

  it('strips trailing CR from CRLF-terminated lines', () => {
    const buf = new LineBuffer();
    expect(buf.push('alpha\r\nbeta\r\n')).toEqual(['alpha', 'beta']);
  });

  it('keeps empty lines between events', () => {
    const buf = new LineBuffer();
    expect(buf.push('a\n\nb\n')).toEqual(['a', '', 'b']);
  });

  it('flush returns any trailing partial line', () => {
    const buf = new LineBuffer();
    buf.push('partial');
    expect(buf.flush()).toEqual(['partial']);
    expect(buf.flush()).toEqual([]);
  });

  it('flush strips trailing CR from leftover', () => {
    const buf = new LineBuffer();
    buf.push('partial\r');
    expect(buf.flush()).toEqual(['partial']);
  });

  it('handles chunks with no newline (no output until flush)', () => {
    const buf = new LineBuffer();
    expect(buf.push('one ')).toEqual([]);
    expect(buf.push('two')).toEqual([]);
    expect(buf.flush()).toEqual(['one two']);
  });
});
