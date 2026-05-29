import { z } from 'zod';

export const whisperModelSchema = z.enum(['tiny.en', 'base.en', 'small.en']);
export type WhisperModel = z.infer<typeof whisperModelSchema>;

export const WHISPER_MODEL_INFO: ReadonlyArray<{
  id: WhisperModel;
  fileName: string;
  displayName: string;
  approxSizeMb: number;
  description: string;
  downloadUrl: string;
}> = [
  {
    id: 'tiny.en',
    fileName: 'ggml-tiny.en.bin',
    displayName: 'Tiny (English)',
    approxSizeMb: 75,
    description: 'Fastest. Lower accuracy. Good for short dictation.',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  },
  {
    id: 'base.en',
    fileName: 'ggml-base.en.bin',
    displayName: 'Base (English)',
    approxSizeMb: 142,
    description: 'Balanced. Recommended default for most users.',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  },
  {
    id: 'small.en',
    fileName: 'ggml-small.en.bin',
    displayName: 'Small (English)',
    approxSizeMb: 466,
    description: 'Higher accuracy. Slower on CPU.',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  },
];

export interface WhisperBinaryStatus {
  found: boolean;
  path: string | null;
  version: string | null;
  source: 'path-env' | 'configured' | 'not-found';
  setupHint: string | null;
}

export const checkBinaryRequestSchema = z.void();
export type CheckBinaryRequest = z.infer<typeof checkBinaryRequestSchema>;

export const checkBinaryResponseSchema = z.object({
  found: z.boolean(),
  path: z.string().nullable(),
  version: z.string().nullable(),
  source: z.enum(['path-env', 'configured', 'not-found']),
  setupHint: z.string().nullable(),
});
export type CheckBinaryResponse = z.infer<typeof checkBinaryResponseSchema>;

export const downloadModelRequestSchema = z.object({
  model: whisperModelSchema,
});
export type DownloadModelRequest = z.infer<typeof downloadModelRequestSchema>;

export const downloadModelResponseSchema = z.object({
  model: whisperModelSchema,
  filePath: z.string(),
  bytes: z.number().int().nonnegative(),
  alreadyExisted: z.boolean(),
});
export type DownloadModelResponse = z.infer<typeof downloadModelResponseSchema>;

export const downloadProgressEventSchema = z.object({
  model: whisperModelSchema,
  receivedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative().nullable(),
  done: z.boolean(),
  error: z.string().nullable(),
});
export type DownloadProgressEvent = z.infer<typeof downloadProgressEventSchema>;

export const startRecordingRequestSchema = z.object({
  model: whisperModelSchema.optional(),
});
export type StartRecordingRequest = z.infer<typeof startRecordingRequestSchema>;

export const startRecordingResponseSchema = z.object({
  sessionId: z.string(),
  model: whisperModelSchema,
});
export type StartRecordingResponse = z.infer<typeof startRecordingResponseSchema>;

export const recordingChunkSchema = z.object({
  sessionId: z.string(),
  // Raw 16-bit PCM mono @ 16kHz, base64 encoded for IPC transit.
  pcm16Base64: z.string(),
});
export type RecordingChunk = z.infer<typeof recordingChunkSchema>;

export const stopRecordingRequestSchema = z.object({
  sessionId: z.string(),
  // Renderer captures the audio via MediaRecorder + AudioContext, encodes to
  // 16kHz mono 16-bit PCM, base64s the final blob, and sends it here so the
  // main process can feed it to whisper-cli via a temp wav file.
  pcm16Base64: z.string(),
});
export type StopRecordingRequest = z.infer<typeof stopRecordingRequestSchema>;

export const transcriptSegmentSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const stopRecordingResponseSchema = z.object({
  sessionId: z.string(),
  transcript: z.string(),
  segments: z.array(transcriptSegmentSchema),
  model: whisperModelSchema,
  durationMs: z.number().int().nonnegative(),
});
export type StopRecordingResponse = z.infer<typeof stopRecordingResponseSchema>;

export const setPttShortcutRequestSchema = z.object({
  // Electron accelerator string, e.g. "Alt+Space" or "" to disable.
  accelerator: z.string(),
});
export type SetPttShortcutRequest = z.infer<typeof setPttShortcutRequestSchema>;

export const setPttShortcutResponseSchema = z.object({
  accelerator: z.string(),
  registered: z.boolean(),
  error: z.string().nullable(),
});
export type SetPttShortcutResponse = z.infer<typeof setPttShortcutResponseSchema>;

export const getVoiceConfigResponseSchema = z.object({
  pttShortcut: z.string(),
  selectedModel: whisperModelSchema,
  binaryPath: z.string().nullable(),
});
export type GetVoiceConfigResponse = z.infer<typeof getVoiceConfigResponseSchema>;

export const setSelectedVoiceModelRequestSchema = z.object({
  model: whisperModelSchema,
});
export type SetSelectedVoiceModelRequest = z.infer<typeof setSelectedVoiceModelRequestSchema>;

export const setBinaryPathRequestSchema = z.object({
  path: z.string().nullable(),
});
export type SetBinaryPathRequest = z.infer<typeof setBinaryPathRequestSchema>;

export const voicePttEventSchema = z.object({
  kind: z.enum(['ptt-press', 'ptt-release']),
});
export type VoicePttEvent = z.infer<typeof voicePttEventSchema>;

export const DEFAULT_PTT_SHORTCUT = 'Alt+Space';
export const DEFAULT_WHISPER_MODEL: WhisperModel = 'base.en';

export const voiceChannels = {
  checkBinary: 'voice:check-binary',
  downloadModel: 'voice:download-model',
  startRecording: 'voice:start-recording',
  stopRecording: 'voice:stop-recording',
  setPttShortcut: 'voice:set-ptt-shortcut',
  getConfig: 'voice:get-config',
  setSelectedModel: 'voice:set-selected-model',
  setBinaryPath: 'voice:set-binary-path',
} as const;

export const voiceEvents = {
  downloadProgress: 'voice:download-progress',
  pttEvent: 'voice:ptt-event',
} as const;
