import { createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { WHISPER_MODEL_INFO, type WhisperModel } from '../../shared/voice';

export interface ProgressCallback {
  (event: { receivedBytes: number; totalBytes: number | null; done: boolean }): void;
}

export interface DownloadOptions {
  model: WhisperModel;
  destinationDir: string;
  fetchImpl?: typeof fetch;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

export interface DownloadResult {
  model: WhisperModel;
  filePath: string;
  bytes: number;
  alreadyExisted: boolean;
}

function modelInfo(model: WhisperModel): (typeof WHISPER_MODEL_INFO)[number] {
  const found = WHISPER_MODEL_INFO.find((m) => m.id === model);
  if (!found) throw new Error(`unknown whisper model: ${model}`);
  return found;
}

export function modelFilePath(model: WhisperModel, dir: string): string {
  return join(dir, modelInfo(model).fileName);
}

export async function isModelDownloaded(model: WhisperModel, dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(modelFilePath(model, dir));
    // Skip absurdly small / corrupted leftover files (anything < 1 MB).
    return stat.isFile() && stat.size > 1_000_000;
  } catch {
    return false;
  }
}

export async function downloadModel(opts: DownloadOptions): Promise<DownloadResult> {
  const info = modelInfo(opts.model);
  await fs.mkdir(opts.destinationDir, { recursive: true });
  const dest = modelFilePath(opts.model, opts.destinationDir);

  if (await isModelDownloaded(opts.model, opts.destinationDir)) {
    const stat = await fs.stat(dest);
    opts.onProgress?.({ receivedBytes: stat.size, totalBytes: stat.size, done: true });
    return {
      model: opts.model,
      filePath: dest,
      bytes: stat.size,
      alreadyExisted: true,
    };
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const response = await fetchFn(info.downloadUrl, {
    redirect: 'follow',
    signal: opts.signal,
  });
  if (!response.ok) {
    throw new Error(
      `failed to download ${info.fileName}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  if (!response.body) {
    throw new Error(`failed to download ${info.fileName}: response has no body`);
  }
  const contentLength = response.headers.get('content-length');
  const totalBytes = contentLength ? Number.parseInt(contentLength, 10) : null;
  const validTotal = totalBytes !== null && Number.isFinite(totalBytes) ? totalBytes : null;

  const tmpPath = `${dest}.part`;
  await fs.rm(tmpPath, { force: true });
  const out = createWriteStream(tmpPath);

  let received = 0;
  const body = response.body as unknown as {
    getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
  };
  const reader = typeof body.getReader === 'function' ? body.getReader() : null;

  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      out.write(Buffer.from(value));
      received += value.byteLength;
      opts.onProgress?.({ receivedBytes: received, totalBytes: validTotal, done: false });
    }
  } else {
    const nodeStream = response.body as unknown as Readable;
    for await (const chunk of nodeStream) {
      const buf = chunk as Buffer;
      out.write(buf);
      received += buf.byteLength;
      opts.onProgress?.({ receivedBytes: received, totalBytes: validTotal, done: false });
    }
  }
  await new Promise<void>((resolve, reject) => {
    out.end((err: NodeJS.ErrnoException | null | undefined) => (err ? reject(err) : resolve()));
  });

  await fs.rename(tmpPath, dest);
  opts.onProgress?.({ receivedBytes: received, totalBytes: validTotal ?? received, done: true });
  return {
    model: opts.model,
    filePath: dest,
    bytes: received,
    alreadyExisted: false,
  };
}
