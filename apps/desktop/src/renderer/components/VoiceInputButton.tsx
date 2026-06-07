import { useCallback, useEffect, useRef, useState } from 'react';
import { HoverHint } from './HoverHint';
import { getBridge } from '../bridge';
import type { WhisperModel } from '../../shared/voice';

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

type RecordingState = 'idle' | 'preparing' | 'recording' | 'transcribing' | 'error';

const TARGET_SAMPLE_RATE = 16000;

// Inline worklet — keeps the renderer bundle a single chunk and avoids a sibling
// public/ asset. The worklet emits whatever the upstream node delivers on
// channel 0 back to the main thread via `port.postMessage`.
const WORKLET_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;
    // Copy because the buffer is reused across render quanta.
    this.port.postMessage(new Float32Array(channel));
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

let workletModuleUrl: string | null = null;
function getWorkletModuleUrl(): string {
  if (workletModuleUrl) return workletModuleUrl;
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
  workletModuleUrl = URL.createObjectURL(blob);
  return workletModuleUrl;
}

function downsampleToMono16k(input: Float32Array, fromRate: number): Int16Array {
  if (fromRate === TARGET_SAMPLE_RATE) {
    return floatToPcm16(input);
  }
  const ratio = fromRate / TARGET_SAMPLE_RATE;
  const newLen = Math.floor(input.length / ratio);
  const out = new Float32Array(newLen);
  let pos = 0;
  for (let i = 0; i < newLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < input.length; j++) {
      sum += input[j] ?? 0;
      count++;
    }
    out[pos++] = count > 0 ? sum / count : 0;
  }
  return floatToPcm16(out);
}

function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? Math.floor(s * 0x8000) : Math.floor(s * 0x7fff);
  }
  return out;
}

function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(binary, 'binary').toString('base64');
}

export function VoiceInputButton({ onTranscript, disabled }: VoiceInputButtonProps): JSX.Element {
  const [state, setState] = useState<RecordingState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [model, setModel] = useState<WhisperModel | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef<number>(TARGET_SAMPLE_RATE);
  const stateRef = useRef<RecordingState>(state);
  const modelRef = useRef<WhisperModel | null>(model);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await bridge.voice.getConfig();
        if (cancelled) return;
        queueMicrotask(() => {
          if (!cancelled) setModel(cfg.selectedModel);
        });
      } catch {
        // Fall back to default below.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const teardown = useCallback(async (): Promise<void> => {
    try {
      if (workletRef.current) {
        workletRef.current.port.onmessage = null;
        workletRef.current.disconnect();
      }
      sourceRef.current?.disconnect();
      workletRef.current = null;
      sourceRef.current = null;
      if (ctxRef.current && ctxRef.current.state !== 'closed') {
        await ctxRef.current.close();
      }
      ctxRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    } catch {
      // best effort
    }
  }, []);

  const teardownRef = useRef(teardown);
  useEffect(() => {
    teardownRef.current = teardown;
  }, [teardown]);

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle' && stateRef.current !== 'error') return;
    const bridge = getBridge();
    if (!bridge) {
      setErrorMsg('Preload bridge unavailable.');
      setState('error');
      return;
    }
    setErrorMsg(null);
    setState('preparing');
    try {
      const check = await bridge.voice.checkBinary();
      if (!check.found) {
        setErrorMsg(check.setupHint ?? 'whisper-cli not found');
        setState('error');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AudioCtor: typeof AudioContext = window.AudioContext;
      const ctx = new AudioCtor();
      ctxRef.current = ctx;
      sampleRateRef.current = ctx.sampleRate;
      await ctx.audioWorklet.addModule(getWorkletModuleUrl());
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const worklet = new AudioWorkletNode(ctx, 'capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });
      workletRef.current = worklet;
      chunksRef.current = [];
      worklet.port.onmessage = (ev: MessageEvent<Float32Array>): void => {
        chunksRef.current.push(ev.data);
      };
      source.connect(worklet);

      const startResp = await bridge.voice.startRecording(modelRef.current ?? undefined);
      sessionIdRef.current = startResp.sessionId;
      setState('recording');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState('error');
      await teardownRef.current();
    }
  }, []);

  const stop = useCallback(async () => {
    if (stateRef.current !== 'recording') return;
    const bridge = getBridge();
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (!sessionId || !bridge) {
      await teardownRef.current();
      setState('idle');
      return;
    }
    setState('transcribing');
    const collected = chunksRef.current;
    chunksRef.current = [];
    await teardownRef.current();
    try {
      const totalFloats = collected.reduce((n, c) => n + c.length, 0);
      const flat = new Float32Array(totalFloats);
      let offset = 0;
      for (const c of collected) {
        flat.set(c, offset);
        offset += c.length;
      }
      const pcm16 = downsampleToMono16k(flat, sampleRateRef.current);
      const base64 = int16ToBase64(pcm16);
      const resp = await bridge.voice.stopRecording({ sessionId, pcm16Base64: base64 });
      if (resp.transcript.trim().length > 0) {
        onTranscriptRef.current(resp.transcript.trim());
      }
      setState('idle');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }, []);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    const off = bridge.voice.onPttEvent((ev) => {
      if (ev.kind === 'ptt-press') {
        const s = stateRef.current;
        if (s === 'idle' || s === 'error') {
          void start();
        } else if (s === 'recording') {
          void stop();
        }
      }
    });
    return off;
  }, [start, stop]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (disabled) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    void start();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (disabled) return;
    e.preventDefault();
    void stop();
  };

  const hint = ((): string => {
    if (state === 'error' && errorMsg) return errorMsg;
    if (state === 'recording') return 'Release to transcribe';
    if (state === 'preparing') return 'Starting microphone…';
    if (state === 'transcribing') return 'Transcribing…';
    return 'Push-to-talk: hold to dictate';
  })();

  return (
    <HoverHint hint={hint}>
      <button
        type="button"
        className={[
          'voice-input-btn',
          state === 'recording' ? 'voice-input-btn-recording' : '',
          state === 'error' ? 'voice-input-btn-error' : '',
          state === 'preparing' ? 'voice-input-btn-preparing' : '',
          state === 'transcribing' ? 'voice-input-btn-transcribing' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        disabled={disabled || state === 'preparing' || state === 'transcribing'}
        aria-label="Voice input (push to talk)"
        aria-pressed={state === 'recording'}
        style={{
          width: 32,
          height: 32,
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--radius-sm)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {state === 'transcribing' ? (
          <span className="mcp-inline-spinner" />
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="5" y="1" width="6" height="9" rx="3" fill="currentColor" />
            <path
              d="M2.5 8a5.5 5.5 0 0 0 11 0"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              fill="none"
            />
            <line
              x1="8"
              y1="13.5"
              x2="8"
              y2="15"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
    </HoverHint>
  );
}
