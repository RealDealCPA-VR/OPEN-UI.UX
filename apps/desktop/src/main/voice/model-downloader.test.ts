import { promises as fs } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rmTmp } from '../../test/rm-tmp';
import { downloadModel, isModelDownloaded, modelFilePath } from './model-downloader';
import type { WhisperModel } from '../../shared/voice';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'voice-dl-'));
});

afterEach(async () => {
  await rmTmp(workDir);
});

function makeBigResponse(bytes: number, headers: Record<string, string> = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller): void {
      const chunkSize = Math.max(1, Math.floor(bytes / 4));
      let written = 0;
      while (written < bytes) {
        const size = Math.min(chunkSize, bytes - written);
        controller.enqueue(new Uint8Array(size));
        written += size;
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-length': String(bytes), ...headers },
  });
}

describe('downloadModel', () => {
  it('writes the model file and reports progress', async () => {
    const model: WhisperModel = 'tiny.en';
    const totalBytes = 2_000_000;
    const fetchImpl = (async () => makeBigResponse(totalBytes)) as unknown as typeof fetch;

    const progress: { receivedBytes: number; done: boolean }[] = [];
    const result = await downloadModel({
      model,
      destinationDir: workDir,
      fetchImpl,
      onProgress: ({ receivedBytes, done }) => progress.push({ receivedBytes, done }),
    });

    expect(result.alreadyExisted).toBe(false);
    expect(result.bytes).toBe(totalBytes);
    const stat = await fs.stat(modelFilePath(model, workDir));
    expect(stat.size).toBe(totalBytes);
    expect(progress.length).toBeGreaterThan(1);
    expect(progress[progress.length - 1]?.done).toBe(true);
  });

  it('short-circuits when the file already exists and is large', async () => {
    const model: WhisperModel = 'base.en';
    const path = modelFilePath(model, workDir);
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(path, Buffer.alloc(2_000_000));

    const fetchImpl = (async () => {
      throw new Error('should not fetch');
    }) as unknown as typeof fetch;

    const result = await downloadModel({
      model,
      destinationDir: workDir,
      fetchImpl,
    });
    expect(result.alreadyExisted).toBe(true);
    expect(result.filePath).toBe(path);
  });

  it('throws on non-OK responses', async () => {
    const fetchImpl = (async () =>
      new Response('nope', { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch;
    await expect(
      downloadModel({
        model: 'tiny.en',
        destinationDir: workDir,
        fetchImpl,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('throws on missing body', async () => {
    const fetchImpl = (async () => {
      const res = new Response(null, { status: 200, statusText: 'OK' });
      return res;
    }) as unknown as typeof fetch;
    await expect(
      downloadModel({
        model: 'tiny.en',
        destinationDir: workDir,
        fetchImpl,
      }),
    ).rejects.toThrow();
  });
});

describe('isModelDownloaded', () => {
  it('returns false when file is missing', async () => {
    expect(await isModelDownloaded('tiny.en', workDir)).toBe(false);
  });

  it('returns false when the file is suspiciously small', async () => {
    const path = modelFilePath('tiny.en', workDir);
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(path, Buffer.alloc(100));
    expect(await isModelDownloaded('tiny.en', workDir)).toBe(false);
  });

  it('returns true for a plausibly-sized file', async () => {
    const path = modelFilePath('tiny.en', workDir);
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(path, Buffer.alloc(2_000_000));
    expect(await isModelDownloaded('tiny.en', workDir)).toBe(true);
  });
});
