import { describe, expect, it } from 'vitest';
import { EngineMismatchError, satisfiesEngineRange } from './engine';

describe('satisfiesEngineRange', () => {
  it('caret 0.x ranges only allow same minor', () => {
    expect(satisfiesEngineRange('0.1.0', '^0.1.0')).toBe(true);
    expect(satisfiesEngineRange('0.1.7', '^0.1.0')).toBe(true);
    expect(satisfiesEngineRange('0.2.0', '^0.1.0')).toBe(false);
    expect(satisfiesEngineRange('0.0.9', '^0.1.0')).toBe(false);
  });

  it('caret 1.x ranges allow any minor.patch >= base', () => {
    expect(satisfiesEngineRange('1.2.3', '^1.2.3')).toBe(true);
    expect(satisfiesEngineRange('1.5.0', '^1.2.3')).toBe(true);
    expect(satisfiesEngineRange('2.0.0', '^1.2.3')).toBe(false);
    expect(satisfiesEngineRange('1.2.2', '^1.2.3')).toBe(false);
  });

  it('tilde ranges only allow patch bumps', () => {
    expect(satisfiesEngineRange('1.2.3', '~1.2.3')).toBe(true);
    expect(satisfiesEngineRange('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfiesEngineRange('1.3.0', '~1.2.3')).toBe(false);
  });

  it('>= ranges compare lexicographically by component', () => {
    expect(satisfiesEngineRange('1.0.0', '>=0.9.0')).toBe(true);
    expect(satisfiesEngineRange('0.8.0', '>=0.9.0')).toBe(false);
  });

  it('exact ranges only allow the exact version', () => {
    expect(satisfiesEngineRange('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesEngineRange('1.2.4', '1.2.3')).toBe(false);
  });

  it('fails closed on unparseable ranges', () => {
    expect(satisfiesEngineRange('1.0.0', 'next')).toBe(false);
    expect(satisfiesEngineRange('not-semver', '^1.0.0')).toBe(false);
  });

  it('* allows everything', () => {
    expect(satisfiesEngineRange('99.0.0', '*')).toBe(true);
  });
});

describe('EngineMismatchError', () => {
  it('records plugin name, range, and host version', () => {
    const err = new EngineMismatchError('demo', '^0.2.0', '0.0.0');
    expect(err.name).toBe('EngineMismatchError');
    expect(err.pluginName).toBe('demo');
    expect(err.required).toBe('^0.2.0');
    expect(err.host).toBe('0.0.0');
    expect(err.message).toMatch(/requires opencodex \^0\.2\.0/);
  });
});
