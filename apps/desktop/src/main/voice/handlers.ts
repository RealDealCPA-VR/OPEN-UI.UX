import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { toFriendlyError } from '../util/friendly-error';
import { logger } from '../logger';
import {
  checkBinaryRequestSchema,
  downloadModelRequestSchema,
  setBinaryPathRequestSchema,
  setPttShortcutRequestSchema,
  setSelectedVoiceModelRequestSchema,
  startRecordingRequestSchema,
  stopRecordingRequestSchema,
  type CheckBinaryResponse,
  type DownloadModelResponse,
  type DownloadProgressEvent,
  type GetVoiceConfigResponse,
  type SetPttShortcutResponse,
  type StartRecordingResponse,
  type StopRecordingResponse,
} from '../../shared/voice';
import {
  checkBinary,
  ensureModel,
  getModelsDir,
  getVoiceConfig,
  setVoiceConfig,
  startSession,
  stopSessionAndTranscribe,
} from './manager';
import { registerPttShortcut } from './global-shortcut';
import { modelFilePath } from './model-downloader';

function broadcastDownloadProgress(payload: DownloadProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('voice:download-progress', payload);
  }
}

export function registerVoiceHandlers(): void {
  registerInvoke<'voice:check-binary'>(
    'voice:check-binary',
    checkBinaryRequestSchema,
    async (): Promise<CheckBinaryResponse> => {
      try {
        return await checkBinary();
      } catch (err) {
        throw toFriendlyError(err);
      }
    },
  );

  registerInvoke<'voice:download-model'>(
    'voice:download-model',
    downloadModelRequestSchema,
    async (req): Promise<DownloadModelResponse> => {
      try {
        const filePath = await ensureModel(req.model, ({ receivedBytes, totalBytes, done }) => {
          broadcastDownloadProgress({
            model: req.model,
            receivedBytes,
            totalBytes,
            done,
            error: null,
          });
        });
        return {
          model: req.model,
          filePath,
          bytes: 0,
          alreadyExisted: filePath === modelFilePath(req.model, getModelsDir()),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        broadcastDownloadProgress({
          model: req.model,
          receivedBytes: 0,
          totalBytes: null,
          done: true,
          error: message,
        });
        throw toFriendlyError(err);
      }
    },
  );

  registerInvoke<'voice:start-recording'>(
    'voice:start-recording',
    startRecordingRequestSchema,
    (req): StartRecordingResponse => startSession(req.model),
  );

  registerInvoke<'voice:stop-recording'>(
    'voice:stop-recording',
    stopRecordingRequestSchema,
    async (req): Promise<StopRecordingResponse> => {
      try {
        return await stopSessionAndTranscribe(req.sessionId, req.pcm16Base64);
      } catch (err) {
        logger.warn({ err }, 'voice: stop-recording failed');
        throw toFriendlyError(err);
      }
    },
  );

  registerInvoke<'voice:set-ptt-shortcut'>(
    'voice:set-ptt-shortcut',
    setPttShortcutRequestSchema,
    (req): SetPttShortcutResponse => {
      const result = registerPttShortcut(req.accelerator);
      if (result.registered || req.accelerator.trim().length === 0) {
        setVoiceConfig({ pttShortcut: req.accelerator });
      }
      return result;
    },
  );

  registerInvoke<'voice:get-config'>(
    'voice:get-config',
    z.void(),
    (): GetVoiceConfigResponse => getVoiceConfig(),
  );

  registerInvoke<'voice:set-selected-model'>(
    'voice:set-selected-model',
    setSelectedVoiceModelRequestSchema,
    (req): GetVoiceConfigResponse => setVoiceConfig({ selectedModel: req.model }),
  );

  registerInvoke<'voice:set-binary-path'>(
    'voice:set-binary-path',
    setBinaryPathRequestSchema,
    (req): GetVoiceConfigResponse => setVoiceConfig({ binaryPath: req.path }),
  );
}

export function bootstrapVoice(): void {
  const cfg = getVoiceConfig();
  if (cfg.pttShortcut && cfg.pttShortcut.length > 0) {
    const result = registerPttShortcut(cfg.pttShortcut);
    if (!result.registered && result.error) {
      logger.warn(
        { accelerator: cfg.pttShortcut, error: result.error },
        'voice: initial PTT shortcut registration failed',
      );
    }
  }
}
