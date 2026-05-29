import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildWavHeader,
  locateWhisperBinary,
  parseWhisperJson,
  transcribeWav,
  writePcm16ToWav,
} from './whisper-local';

type FakeStream = EventEmitter;

interface FakeChild extends EventEmitter {
  stdout: FakeStream;
  stderr: FakeStream;
}

function makeFakeChild(opts: {
  stdout?: string;
  stderr?: string;
  code: number;
  failSpawn?: boolean;
}): {
  spawn: (cmd: string, args: readonly string[]) => FakeChild;
  lastCmd: { cmd: string; args: readonly string[] } | null;
} {
  let lastCmd: { cmd: string; args: readonly string[] } | null = null;
  return {
    lastCmd,
    spawn: (cmd: string, args: readonly string[]): FakeChild => {
      lastCmd = { cmd, args };
      if (opts.failSpawn) {
        throw new Error('spawn ENOENT');
      }
      const stdout = new EventEmitter() as FakeStream;
      const stderr = new EventEmitter() as FakeStream;
      const child = new EventEmitter() as FakeChild;
      child.stdout = stdout;
      child.stderr = stderr;
      queueMicrotask(() => {
        if (opts.stdout) stdout.emit('data', Buffer.from(opts.stdout));
        if (opts.stderr) stderr.emit('data', Buffer.from(opts.stderr));
        child.emit('close', opts.code);
      });
      return child;
    },
  };
}

describe('locateWhisperBinary', () => {
  it('uses configured path when the file exists', async () => {
    const tmpFile = join(tmpdir(), `fake-whisper-${Date.now()}`);
    await fs.writeFile(tmpFile, '#!/bin/sh\n');
    try {
      const fake = makeFakeChild({ stdout: 'whisper.cpp v1.5.4\n', code: 0 });
      const status = await locateWhisperBinary({
        configuredPath: tmpFile,
        spawnImpl: fake.spawn as never,
      });
      expect(status.found).toBe(true);
      expect(status.source).toBe('configured');
      expect(status.path).toBe(tmpFile);
    } finally {
      await fs.rm(tmpFile, { force: true });
    }
  });

  it('falls back to which / where lookup', async () => {
    const fake = makeFakeChild({ stdout: '/usr/local/bin/whisper-cli\n', code: 0 });
    const status = await locateWhisperBinary({
      configuredPath: null,
      spawnImpl: fake.spawn as never,
      platform: 'linux',
    });
    expect(status.found).toBe(true);
    expect(status.path).toBe('/usr/local/bin/whisper-cli');
    expect(status.source).toBe('path-env');
  });

  it('returns a setup hint when nothing is found', async () => {
    const fake = makeFakeChild({ stdout: '', code: 1 });
    const status = await locateWhisperBinary({
      configuredPath: null,
      spawnImpl: fake.spawn as never,
      platform: 'darwin',
    });
    expect(status.found).toBe(false);
    expect(status.source).toBe('not-found');
    expect(status.setupHint).toMatch(/whisper\.cpp/);
  });

  it('survives spawn errors', async () => {
    const fake = makeFakeChild({ stdout: '', code: 0, failSpawn: true });
    const status = await locateWhisperBinary({
      configuredPath: null,
      spawnImpl: fake.spawn as never,
      platform: 'win32',
    });
    expect(status.found).toBe(false);
  });
});

describe('parseWhisperJson', () => {
  it('extracts segments and transcript', () => {
    const raw = JSON.stringify({
      text: ' hello world ',
      transcription: [
        { text: ' hello', offsets: { from: 0, to: 500 } },
        { text: ' world', offsets: { from: 500, to: 1000 } },
        { text: '' },
      ],
    });
    const parsed = parseWhisperJson(raw);
    expect(parsed.transcript).toBe('hello world');
    expect(parsed.segments).toEqual([
      { startMs: 0, endMs: 500, text: 'hello' },
      { startMs: 500, endMs: 1000, text: 'world' },
    ]);
  });

  it('falls back to joined segments when text is missing', () => {
    const raw = JSON.stringify({
      transcription: [{ text: 'a' }, { text: 'b' }],
    });
    const parsed = parseWhisperJson(raw);
    expect(parsed.transcript).toBe('a b');
  });

  it('handles malformed input gracefully', () => {
    const parsed = parseWhisperJson('null');
    expect(parsed.transcript).toBe('');
    expect(parsed.segments).toEqual([]);
  });
});

describe('buildWavHeader / writePcm16ToWav', () => {
  it('writes a valid RIFF header in front of PCM', async () => {
    const tmp = join(tmpdir(), `voice-test-${Date.now()}.wav`);
    const samples = Buffer.alloc(32);
    samples.writeInt16LE(1234, 0);
    samples.writeInt16LE(-1234, 2);
    try {
      await writePcm16ToWav(samples, tmp, 16000);
      const data = await fs.readFile(tmp);
      expect(data.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(data.subarray(8, 12).toString('ascii')).toBe('WAVE');
      expect(data.subarray(12, 16).toString('ascii')).toBe('fmt ');
      expect(data.readUInt32LE(24)).toBe(16000);
      expect(data.subarray(36, 40).toString('ascii')).toBe('data');
      expect(data.readUInt32LE(40)).toBe(samples.length);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  });

  it('header math handles odd buffer lengths', () => {
    const header = buildWavHeader(101, 16000);
    expect(header.readUInt32LE(4)).toBe(36 + 101);
    expect(header.readUInt32LE(40)).toBe(101);
  });
});

let createdFiles: string[] = [];
afterEach(async () => {
  for (const f of createdFiles) await fs.rm(f, { force: true });
  createdFiles = [];
});

describe('transcribeWav', () => {
  it('runs the binary and parses the output JSON file', async () => {
    const wavPath = join(tmpdir(), `transcribe-test-${Date.now()}.wav`);
    const jsonPath = `${wavPath}.json`;
    createdFiles.push(wavPath, jsonPath);
    await fs.writeFile(wavPath, '');
    await fs.writeFile(
      jsonPath,
      JSON.stringify({ text: 'hello there', transcription: [{ text: 'hello there' }] }),
    );

    const fake = makeFakeChild({ stdout: '', code: 0 });
    const result = await transcribeWav({
      binaryPath: '/fake/whisper-cli',
      modelPath: '/fake/model.bin',
      wavPath,
      spawnImpl: fake.spawn as never,
    });
    expect(result.transcript).toBe('hello there');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects when whisper-cli exits non-zero', async () => {
    const wavPath = join(tmpdir(), `transcribe-fail-${Date.now()}.wav`);
    createdFiles.push(wavPath);
    await fs.writeFile(wavPath, '');
    const fake = makeFakeChild({ stdout: '', stderr: 'boom', code: 2 });
    await expect(
      transcribeWav({
        binaryPath: '/fake/whisper-cli',
        modelPath: '/fake/model.bin',
        wavPath,
        spawnImpl: fake.spawn as never,
      }),
    ).rejects.toThrow(/exited with code 2/);
  });
});
