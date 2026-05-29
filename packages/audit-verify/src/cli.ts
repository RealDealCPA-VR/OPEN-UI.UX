import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { parseEnvelope, verifyAuditBundle } from './index.js';

const USAGE =
  'Usage: audit-verify <bundle.json | -> [--public-key <pem-or-base64>] [--accept-embedded-pubkey]\n' +
  '       audit-verify --help\n' +
  '\n' +
  'By default the verifier uses the public key passed via --public-key. If you\n' +
  'must trust the public key embedded inside the bundle (the historical\n' +
  'OpenCodex export format), pass --accept-embedded-pubkey explicitly.\n' +
  'Use `-` as the bundle path to read JSON from stdin.\n';

export interface CliStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin?: NodeJS.ReadableStream;
}

interface ParsedArgs {
  bundlePath: string;
  publicKeyOverride: string | undefined;
  acceptEmbeddedPubkey: boolean;
}

function isFlagShapedValue(value: string): boolean {
  return /^--?[a-zA-Z][a-zA-Z0-9-]*$/.test(value);
}

function parseArgs(argv: readonly string[], streams: CliStreams): ParsedArgs | number {
  let bundlePath: string | null = null;
  let publicKeyOverride: string | undefined;
  let acceptEmbeddedPubkey = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--public-key') {
      const next = argv[++i];
      if (next === undefined || next.length === 0) {
        streams.stderr.write('--public-key requires a value\n');
        return 1;
      }
      if (isFlagShapedValue(next)) {
        streams.stderr.write(`--public-key value cannot start with "-" (got: ${next})\n`);
        return 1;
      }
      publicKeyOverride = next;
    } else if (arg === '--accept-embedded-pubkey') {
      acceptEmbeddedPubkey = true;
    } else if (arg === '-') {
      if (bundlePath !== null) {
        streams.stderr.write(`unexpected argument: ${arg}\n`);
        streams.stderr.write(USAGE);
        return 1;
      }
      bundlePath = '-';
    } else if (arg.startsWith('--')) {
      streams.stderr.write(`unknown flag: ${arg}\n`);
      streams.stderr.write(USAGE);
      return 1;
    } else if (bundlePath === null) {
      bundlePath = arg;
    } else {
      streams.stderr.write(`unexpected argument: ${arg}\n`);
      streams.stderr.write(USAGE);
      return 1;
    }
  }

  if (bundlePath === null) {
    streams.stderr.write(USAGE);
    return 1;
  }

  return { bundlePath, publicKeyOverride, acceptEmbeddedPubkey };
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function main(argv: readonly string[], streams: CliStreams): Promise<number> {
  if (argv.length === 0) {
    streams.stderr.write(USAGE);
    return 1;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    streams.stdout.write(USAGE);
    return 0;
  }

  const parsed = parseArgs(argv, streams);
  if (typeof parsed === 'number') return parsed;

  if (!parsed.acceptEmbeddedPubkey && parsed.publicKeyOverride === undefined) {
    streams.stderr.write(
      'refusing to verify: no trust anchor supplied.\n' +
        'Pass --public-key <pem-or-base64> to pin a key, or --accept-embedded-pubkey to fall back to the public key carried inside the bundle.\n',
    );
    return 2;
  }

  let raw: string;
  if (parsed.bundlePath === '-') {
    const stdin = streams.stdin;
    if (!stdin) {
      streams.stderr.write('stdin not available\n');
      return 1;
    }
    try {
      raw = await readAll(stdin);
    } catch (err) {
      streams.stderr.write(`failed to read stdin: ${errMessage(err)}\n`);
      return 1;
    }
  } else {
    try {
      raw = await readFile(parsed.bundlePath, 'utf8');
    } catch (err) {
      streams.stderr.write(`failed to read ${parsed.bundlePath}: ${errMessage(err)}\n`);
      return 1;
    }
  }

  let envelope;
  try {
    envelope = parseEnvelope(raw);
  } catch (err) {
    streams.stderr.write(`invalid bundle: ${errMessage(err)}\n`);
    return 1;
  }

  const result = verifyAuditBundle(envelope, { publicKeyOverride: parsed.publicKeyOverride });
  if (result.ok) {
    streams.stdout.write(
      `OK  device=${result.deviceId} entries=${result.entryCount} generatedAt=${result.generatedAt}\n`,
    );
    return 0;
  }
  streams.stderr.write(`INVALID  ${result.reason ?? 'verification failed'}\n`);
  return 1;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
