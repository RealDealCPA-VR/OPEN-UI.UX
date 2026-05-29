#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseEnvelope, verifyAuditBundle } from '../dist/index.js';

function usage() {
  process.stderr.write(
    'Usage: audit-verify <bundle.json> [--public-key <pem-or-base64>]\n' +
      '       audit-verify --help\n',
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    usage();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  let bundlePath = null;
  let publicKeyOverride;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--public-key') {
      publicKeyOverride = argv[++i];
      if (!publicKeyOverride) {
        process.stderr.write('--public-key requires a value\n');
        process.exit(1);
      }
    } else if (arg.startsWith('--')) {
      process.stderr.write(`unknown flag: ${arg}\n`);
      usage();
      process.exit(1);
    } else if (!bundlePath) {
      bundlePath = arg;
    } else {
      process.stderr.write(`unexpected argument: ${arg}\n`);
      usage();
      process.exit(1);
    }
  }

  if (!bundlePath) {
    usage();
    process.exit(1);
  }

  let raw;
  try {
    raw = await readFile(bundlePath, 'utf8');
  } catch (err) {
    process.stderr.write(`failed to read ${bundlePath}: ${err.message}\n`);
    process.exit(1);
  }

  let envelope;
  try {
    envelope = parseEnvelope(raw);
  } catch (err) {
    process.stderr.write(`invalid bundle: ${err.message}\n`);
    process.exit(1);
  }

  const result = verifyAuditBundle(envelope, { publicKeyOverride });
  if (result.ok) {
    process.stdout.write(
      `OK  device=${result.deviceId} entries=${result.entryCount} generatedAt=${result.generatedAt}\n`,
    );
    process.exit(0);
  } else {
    process.stderr.write(`INVALID  ${result.reason ?? 'verification failed'}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.message}\n`);
  process.exit(1);
});
