import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_BUNDLE_FORMAT,
  type AuditBundle,
  type AuditBundleEnvelope,
  canonicalizeBundle,
} from './index';
import { main } from './cli';

class StringSink extends Writable {
  chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    cb();
  }
  text(): string {
    return this.chunks.join('');
  }
}

function makeEnvelope(): {
  envelope: AuditBundleEnvelope;
  publicKeyPem: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const bundle: AuditBundle = {
    format: AUDIT_BUNDLE_FORMAT,
    generatedAt: '2026-05-28T00:00:00.000Z',
    deviceId: 'dev-1',
    publicKey: publicKeyPem,
    entries: [
      {
        id: 'a',
        messageId: 'm',
        toolName: 'read_file',
        input: {},
        output: null,
        decision: 'auto',
        isError: false,
        durationMs: 1,
        createdAt: '2026-05-28T00:00:00.000Z',
        triggerSource: 'user',
        runnerId: null,
      },
    ],
  };
  const signature = sign(null, canonicalizeBundle(bundle), privateKey).toString('base64');
  return { envelope: { bundle, signature }, publicKeyPem };
}

function writeEnvelope(envelope: AuditBundleEnvelope): string {
  const dir = mkdtempSync(join(tmpdir(), 'audit-verify-'));
  const path = join(dir, 'bundle.json');
  writeFileSync(path, JSON.stringify(envelope));
  return path;
}

describe('audit-verify CLI (main)', () => {
  it('prints --help to stdout (not stderr) and exits 0', async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await main(['--help'], { stdout, stderr });
    expect(code).toBe(0);
    expect(stdout.text()).toContain('Usage: audit-verify');
    expect(stderr.text()).toBe('');
  });

  it('with no args exits 1 and writes usage to stderr', async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await main([], { stdout, stderr });
    expect(code).toBe(1);
    expect(stderr.text()).toContain('Usage: audit-verify');
    expect(stdout.text()).toBe('');
  });

  it('refuses to verify without a trust anchor', async () => {
    const { envelope } = makeEnvelope();
    const path = writeEnvelope(envelope);
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await main([path], { stdout, stderr });
    expect(code).toBe(2);
    expect(stderr.text()).toMatch(/refusing to verify/i);
    expect(stdout.text()).toBe('');
  });

  it('verifies with --public-key against a freshly-signed bundle', async () => {
    const { envelope, publicKeyPem } = makeEnvelope();
    const path = writeEnvelope(envelope);
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await main([path, '--public-key', publicKeyPem], { stdout, stderr });
    expect(code).toBe(0);
    expect(stdout.text()).toMatch(/^OK\b/);
    expect(stderr.text()).toBe('');
  });

  it('verifies with --accept-embedded-pubkey (audit re-use case)', async () => {
    const { envelope } = makeEnvelope();
    const path = writeEnvelope(envelope);
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await main([path, '--accept-embedded-pubkey'], { stdout, stderr });
    expect(code).toBe(0);
    expect(stdout.text()).toMatch(/^OK\b/);
  });

  it('reads the bundle from stdin when path is "-"', async () => {
    const { envelope, publicKeyPem } = makeEnvelope();
    const stdin: Readable = new PassThrough();
    stdin.push(JSON.stringify(envelope));
    stdin.push(null);
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await main(['-', '--public-key', publicKeyPem], { stdout, stderr, stdin });
    expect(code).toBe(0);
    expect(stdout.text()).toMatch(/^OK\b/);
  });

  it('rejects flag-shaped values for --public-key', async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await main(['bundle.json', '--public-key', '--evil'], { stdout, stderr });
    expect(code).toBe(1);
    expect(stderr.text()).toMatch(/--public-key/);
    expect(stdout.text()).toBe('');
  });

  it('rejects a missing --public-key value', async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await main(['bundle.json', '--public-key'], { stdout, stderr });
    expect(code).toBe(1);
    expect(stderr.text()).toMatch(/--public-key requires/);
  });

  it('rejects unknown flags', async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await main(['--nope'], { stdout, stderr });
    expect(code).toBe(1);
    expect(stderr.text()).toMatch(/unknown flag/);
  });

  it('reports failure for a tampered signature', async () => {
    const { envelope, publicKeyPem } = makeEnvelope();
    const tampered = {
      ...envelope,
      bundle: {
        ...envelope.bundle,
        deviceId: 'attacker',
      },
    };
    const path = writeEnvelope(tampered);
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await main([path, '--public-key', publicKeyPem], { stdout, stderr });
    expect(code).toBe(1);
    expect(stderr.text()).toMatch(/INVALID/);
  });
});

describe('audit-verify CLI (built bin)', () => {
  const here = fileURLToPath(import.meta.url);
  const pkgRoot = resolve(here, '..', '..');
  const distPath = join(pkgRoot, 'dist', 'index.js');
  const binPath = join(pkgRoot, 'bin', 'audit-verify.mjs');

  (existsSync(distPath) ? it : it.skip)(
    'runs end-to-end against the built bin (only when dist/ exists)',
    () => {
      const { envelope, publicKeyPem } = makeEnvelope();
      const path = writeEnvelope(envelope);
      const r = spawnSync(process.execPath, [binPath, path, '--public-key', publicKeyPem], {
        encoding: 'utf8',
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^OK\b/);
    },
  );
});
