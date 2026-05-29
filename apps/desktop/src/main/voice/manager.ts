import { app } from 'electron';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { logger } from '../logger';
import { DEFAULT_PTT_SHORTCUT, DEFAULT_WHISPER_MODEL, type WhisperModel } from '../../shared/voice';
import {
  locateWhisperBinary,
  makeTempWavPath,
  transcribeWav,
  writePcm16ToWav,
} from './whisper-local';
import {
  downloadModel,
  isModelDownloaded,
  modelFilePath,
  type DownloadOptions,
} from './model-downloader';

export interface VoiceConfig {
  pttShortcut: string;
  selectedModel: WhisperModel;
  binaryPath: string | null;
}

// In-memory by default; the settings lane owns persisted prefs and the
// handlers integrate with settingsStore patches via integration patches.
let voiceConfig: VoiceConfig = {
  pttShortcut: DEFAULT_PTT_SHORTCUT,
  selectedModel: DEFAULT_WHISPER_MODEL,
  binaryPath: null,
};

interface ActiveSession {
  id: string;
  startedAt: number;
  model: WhisperModel;
}

const sessions = new Map<string, ActiveSession>();

export function getVoiceConfig(): VoiceConfig {
  return { ...voiceConfig };
}

export function setVoiceConfig(patch: Partial<VoiceConfig>): VoiceConfig {
  voiceConfig = { ...voiceConfig, ...patch };
  return getVoiceConfig();
}

export function getModelsDir(): string {
  return join(app.getPath('userData'), 'whisper-models');
}

export async function checkBinary(): Promise<{
  found: boolean;
  path: string | null;
  version: string | null;
  source: 'path-env' | 'configured' | 'not-found';
  setupHint: string | null;
}> {
  return locateWhisperBinary({ configuredPath: voiceConfig.binaryPath });
}

export async function ensureModel(
  model: WhisperModel,
  onProgress?: DownloadOptions['onProgress'],
): Promise<string> {
  const dir = getModelsDir();
  if (await isModelDownloaded(model, dir)) {
    return modelFilePath(model, dir);
  }
  const result = await downloadModel({
    model,
    destinationDir: dir,
    onProgress,
  });
  return result.filePath;
}

export function startSession(model: WhisperModel | undefined): {
  sessionId: string;
  model: WhisperModel;
} {
  const id = randomUUID();
  const effective = model ?? voiceConfig.selectedModel;
  sessions.set(id, { id, startedAt: Date.now(), model: effective });
  return { sessionId: id, model: effective };
}

export async function stopSessionAndTranscribe(
  sessionId: string,
  pcm16Base64: string,
): Promise<{
  sessionId: string;
  transcript: string;
  segments: { startMs: number; endMs: number; text: string }[];
  model: WhisperModel;
  durationMs: number;
}> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`unknown voice session: ${sessionId}`);
  }
  sessions.delete(sessionId);

  const binary = await checkBinary();
  if (!binary.found || !binary.path) {
    throw new Error(binary.setupHint ?? 'whisper-cli binary not found');
  }
  const modelPath = await ensureModel(session.model);
  const pcm = Buffer.from(pcm16Base64, 'base64');
  const wavPath = makeTempWavPath();
  try {
    await writePcm16ToWav(pcm, wavPath);
    const result = await transcribeWav({
      binaryPath: binary.path,
      modelPath,
      wavPath,
    });
    return {
      sessionId,
      transcript: result.transcript,
      segments: result.segments,
      model: session.model,
      durationMs: result.durationMs,
    };
  } finally {
    await fs.rm(wavPath, { force: true }).catch((err: unknown) => {
      logger.debug({ err, wavPath }, 'voice: temp wav cleanup failed');
    });
    await fs.rm(`${wavPath}.json`, { force: true }).catch(() => {
      // best effort
    });
  }
}
