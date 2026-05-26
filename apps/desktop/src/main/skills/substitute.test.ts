import { describe, expect, it } from 'vitest';
import { isoDate, parseInvocationArgs, substitute, type SubstituteVars } from './substitute';

const baseVars: SubstituteVars = {
  args: {},
  workspace: '/repo',
  date: '2026-05-26',
  gitBranch: 'main',
};

describe('substitute', () => {
  it('substitutes built-in vars', () => {
    const res = substitute('ws={{workspace}} d={{date}} b={{git_branch}}', baseVars);
    expect(res.text).toBe('ws=/repo d=2026-05-26 b=main');
    expect(res.unknownTokens).toEqual([]);
  });

  it('substitutes user args', () => {
    const res = substitute('Hello {{name}}!', { ...baseVars, args: { name: 'World' } });
    expect(res.text).toBe('Hello World!');
  });

  it('substitutes a repeated arg', () => {
    const res = substitute('{{x}}-{{x}}-{{x}}', { ...baseVars, args: { x: 'A' } });
    expect(res.text).toBe('A-A-A');
  });

  it('substitutes multiple args in one call', () => {
    const res = substitute('{{a}} and {{b}}', { ...baseVars, args: { a: '1', b: '2' } });
    expect(res.text).toBe('1 and 2');
  });

  it('leaves unknown tokens in place and reports them', () => {
    const res = substitute('{{a}} {{missing}}', { ...baseVars, args: { a: 'X' } });
    expect(res.text).toBe('X {{missing}}');
    expect(res.unknownTokens).toEqual(['missing']);
  });

  it('does not let user args override built-ins', () => {
    const res = substitute('{{workspace}}', {
      ...baseVars,
      args: { workspace: 'override' },
    });
    expect(res.text).toBe('/repo');
  });

  it('handles whitespace inside braces', () => {
    const res = substitute('hi {{ name }} bye', { ...baseVars, args: { name: 'world' } });
    expect(res.text).toBe('hi world bye');
  });

  it('treats empty workspace as empty string', () => {
    const res = substitute('[{{workspace}}]', { ...baseVars, workspace: '' });
    expect(res.text).toBe('[]');
  });
});

describe('isoDate', () => {
  it('formats as YYYY-MM-DD in UTC', () => {
    const d = new Date(Date.UTC(2026, 4, 26, 12, 0, 0));
    expect(isoDate(d)).toBe('2026-05-26');
  });

  it('handles single-digit month and day with zero-padding', () => {
    const d = new Date(Date.UTC(2026, 0, 3));
    expect(isoDate(d)).toBe('2026-01-03');
  });
});

describe('parseInvocationArgs', () => {
  it('parses simple key=value pairs', () => {
    const res = parseInvocationArgs('foo=bar baz=qux');
    expect(res.args).toEqual({ foo: 'bar', baz: 'qux' });
    expect(res.rest).toBe('');
  });

  it('parses double-quoted values containing spaces', () => {
    const res = parseInvocationArgs('topic="security audit" depth=deep');
    expect(res.args.topic).toBe('security audit');
    expect(res.args.depth).toBe('deep');
  });

  it('returns rest text when no pairs match', () => {
    const res = parseInvocationArgs('just a sentence');
    expect(res.args).toEqual({});
    expect(res.rest).toBe('just a sentence');
  });

  it('mixes pairs and rest text', () => {
    const res = parseInvocationArgs('hello foo=bar world');
    expect(res.args).toEqual({ foo: 'bar' });
    expect(res.rest).toBe('hello world');
  });

  it('returns the last value when the same key appears twice', () => {
    const res = parseInvocationArgs('foo=1 foo=2');
    expect(res.args).toEqual({ foo: '2' });
  });

  it('accepts identifiers with digits and underscores', () => {
    const res = parseInvocationArgs('arg_2=value');
    expect(res.args).toEqual({ arg_2: 'value' });
  });
});
