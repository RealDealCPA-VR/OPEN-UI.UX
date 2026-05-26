import { describe, expect, it } from 'vitest';
import {
  assertTriggerSupported,
  describeTrigger,
  isSupportedTrigger,
  parseTriggerJson,
  serializeTrigger,
  triggerSchema,
  type Trigger,
} from './types';

describe('trigger schema', () => {
  it('accepts a manual trigger', () => {
    const t: Trigger = { type: 'manual' };
    expect(triggerSchema.parse(t)).toEqual(t);
  });

  it('accepts a cron trigger', () => {
    const t: Trigger = { type: 'cron', expr: '0 9 * * *' };
    expect(triggerSchema.parse(t)).toEqual(t);
  });

  it('rejects an unknown type', () => {
    expect(() => triggerSchema.parse({ type: 'bogus' })).toThrow();
  });

  it('rejects a cron trigger with empty expression', () => {
    expect(() => triggerSchema.parse({ type: 'cron', expr: '' })).toThrow();
  });

  it('round-trips through serializeTrigger / parseTriggerJson', () => {
    const a: Trigger = { type: 'manual' };
    const b: Trigger = { type: 'cron', expr: '*/5 * * * *' };
    expect(parseTriggerJson(serializeTrigger(a))).toEqual(a);
    expect(parseTriggerJson(serializeTrigger(b))).toEqual(b);
  });

  it('parseTriggerJson throws on invalid JSON', () => {
    expect(() => parseTriggerJson('{not-json')).toThrow(/invalid trigger JSON/);
  });

  it('parseTriggerJson throws on schema violations', () => {
    expect(() => parseTriggerJson('{"type":"wat"}')).toThrow(/invalid trigger shape/);
  });
});

describe('isSupportedTrigger / assertTriggerSupported', () => {
  it('all five trigger variants are supported', () => {
    expect(isSupportedTrigger({ type: 'manual' })).toBe(true);
    expect(isSupportedTrigger({ type: 'cron', expr: '* * * * *' })).toBe(true);
    expect(isSupportedTrigger({ type: 'file-change', glob: '**/*' })).toBe(true);
    expect(isSupportedTrigger({ type: 'git-hook', hook: 'post-commit' })).toBe(true);
    expect(isSupportedTrigger({ type: 'webhook', secret: 's' })).toBe(true);
  });

  it('assertTriggerSupported is a no-op for every variant', () => {
    expect(() => assertTriggerSupported({ type: 'manual' })).not.toThrow();
    expect(() => assertTriggerSupported({ type: 'cron', expr: '* * * * *' })).not.toThrow();
    expect(() => assertTriggerSupported({ type: 'file-change', glob: '**/*' })).not.toThrow();
    expect(() => assertTriggerSupported({ type: 'git-hook', hook: 'pre-push' })).not.toThrow();
    expect(() => assertTriggerSupported({ type: 'webhook', secret: 'x' })).not.toThrow();
  });

  it('assertTriggerSupported throws for genuinely-unknown types', () => {
    expect(() => assertTriggerSupported({ type: 'bogus' } as unknown as Trigger)).toThrow(
      /Not implemented/,
    );
  });
});

describe('describeTrigger', () => {
  it('produces a human-readable label for each variant', () => {
    expect(describeTrigger({ type: 'manual' })).toBe('Manual');
    expect(describeTrigger({ type: 'cron', expr: '0 9 * * 1' })).toContain('0 9 * * 1');
    expect(describeTrigger({ type: 'file-change', glob: '*.ts' })).toContain('*.ts');
    expect(describeTrigger({ type: 'git-hook', hook: 'post-commit' })).toContain('post-commit');
    expect(describeTrigger({ type: 'webhook', secret: 'x' })).toBe('Webhook');
  });
});
