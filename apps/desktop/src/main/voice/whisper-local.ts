import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TranscriptSegment, WhisperBinaryStatus } from '../../shared/voice';

export interface SpawnLike {
  (command: string, args: readonly string[], options?: SpawnOptions): ChildProcess;
}

export interface WhisperLocateOptions {
  configuredPath: string | null;
  spawnImpl?: SpawnLike;
  platform?: NodeJS.Platform;
  pathEnv?: string;
}

const SETUP_HINT = [
  'whisper.cpp binary not found.',
  'Install whisper.cpp and ensure the "whisper-cli" (or "main") executable is on your PATH,',
  'or configure its absolute path in Settings → Accessibility → Voice input.',
  'See https://github.com/ggerganov/whisper.cpp for build instructions.',
].join(' ');

function whichCommand(platform: NodeJS.Platform): { cmd: string; args: string[] } {
  if (platform === 'win32') {
    return { cmd: 'where.exe', args: ['whisper-cli'] };
  }
  return { cmd: 'which', args: ['whisper-cli'] };
}

async function fileIsExecutable(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function locateWhisperBinary(
  opts: WhisperLocateOptions,
): Promise<WhisperBinaryStatus> {
  const spawnImpl = opts.spawnImpl ?? (spawn as unknown as SpawnLike);
  const platform = opts.platform ?? process.platform;

  if (opts.configuredPath && opts.configuredPath.length > 0) {
    const ok = await fileIsExecutable(opts.configuredPath);
    if (ok) {
      const version = await readVersion(opts.configuredPath, spawnImpl);
      return {
        found: true,
        path: opts.configuredPath,
        version,
        source: 'configured',
        setupHint: null,
      };
    }
  }

  const { cmd, args } = whichCommand(platform);
  const path = await new Promise<string | null>((resolve) => {
    try {
      const child = spawnImpl(cmd, args, {
        env: { ...process.env, ...(opts.pathEnv ? { PATH: opts.pathEnv } : {}) },
      });
      let stdout = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.on('error', () => resolve(null));
      child.on('close', (code) => {
        if (code !== 0) return resolve(null);
        const first = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l.length > 0);
        resolve(first ?? null);
      });
    } catch {
      resolve(null);
    }
  });

  if (!path) {
    return {
      found: false,
      path: null,
      version: null,
      source: 'not-found',
      setupHint: SETUP_HINT,
    };
  }

  const version = await readVersion(path, spawnImpl);
  return {
    found: true,
    path,
    version,
    source: 'path-env',
    setupHint: null,
  };
}

async function readVersion(binPath: string, spawnImpl: SpawnLike): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    try {
      const child = spawnImpl(binPath, ['--help'], {});
      let combined = '';
      child.stdout?.on('data', (c: Buffer) => {
        combined += c.toString('utf8');
      });
      child.stderr?.on('data', (c: Buffer) => {
        combined += c.toString('utf8');
      });
      child.on('error', () => resolve(null));
      child.on('close', () => {
        const match = combined.match(/whisper\.cpp[^\n]*?v[0-9][^\s]*/i);
        resolve(match?.[0] ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

export interface TranscribeOptions {
  binaryPath: string;
  modelPath: string;
  wavPath: string;
  language?: string;
  spawnImpl?: SpawnLike;
}

export interface TranscribeResult {
  transcript: string;
  segments: TranscriptSegment[];
  durationMs: number;
}

/**
 * Runs whisper-cli on a wav file and parses streamed JSON output. We use
 * --output-json (whisper.cpp >= 1.5) which writes <wav>.json alongside the
 * input.
 */
export async function transcribeWav(opts: TranscribeOptions): Promise<TranscribeResult> {
  const spawnImpl = opts.spawnImpl ?? (spawn as unknown as SpawnLike);
  const startedAt = Date.now();
  const args: string[] = ['-m', opts.modelPath, '-f', opts.wavPath, '--output-json', '--no-prints'];
  if (opts.language) {
    args.push('-l', opts.language);
  }

  await new Promise<void>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnImpl(opts.binaryPath, args, {});
    } catch (err) {
      reject(err);
      return;
    }
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`whisper-cli exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });

  const jsonPath = `${opts.wavPath}.json`;
  const raw = await fs.readFile(jsonPath, 'utf8');
  const parsed = parseWhisperJson(raw);
  return {
    transcript: parsed.transcript,
    segments: parsed.segments,
    durationMs: Date.now() - startedAt,
  };
}

export function parseWhisperJson(raw: string): {
  transcript: string;
  segments: TranscriptSegment[];
} {
  const data = JSON.parse(raw) as unknown;
  const segments: TranscriptSegment[] = [];
  if (typeof data !== 'object' || data === null) {
    return { transcript: '', segments };
  }
  const obj = data as Record<string, unknown>;
  const trans = obj['transcription'];
  if (Array.isArray(trans)) {
    for (const item of trans) {
      if (typeof item !== 'object' || item === null) continue;
      const seg = item as Record<string, unknown>;
      const text = typeof seg['text'] === 'string' ? (seg['text'] as string).trim() : '';
      if (text.length === 0) continue;
      const offsets =
        typeof seg['offsets'] === 'object' && seg['offsets'] !== null
          ? (seg['offsets'] as Record<string, unknown>)
          : null;
      const startMs = typeof offsets?.['from'] === 'number' ? (offsets['from'] as number) : 0;
      const endMs = typeof offsets?.['to'] === 'number' ? (offsets['to'] as number) : startMs;
      segments.push({ startMs, endMs, text });
    }
  }
  const fullText =
    typeof obj['text'] === 'string'
      ? (obj['text'] as string).trim()
      : segments
          .map((s) => s.text)
          .join(' ')
          .trim();
  return { transcript: fullText, segments };
}

export async function writePcm16ToWav(
  pcm16: Buffer,
  outPath: string,
  sampleRate = 16000,
): Promise<void> {
  const header = buildWavHeader(pcm16.length, sampleRate);
  await fs.writeFile(outPath, Buffer.concat([header, pcm16]));
}

export function buildWavHeader(dataLength: number, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLength, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLength, 40);
  return buf;
}

export function makeTempWavPath(): string {
  return join(tmpdir(), `opencodex-voice-${randomUUID()}.wav`);
}
