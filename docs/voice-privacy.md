# Voice / dictation privacy

OpenCodex ships voice input as a **local-only** feature. In v1 there is no cloud
speech-to-text (STT) backend, no remote model invocation, and no transcript
upload — every step of capture, recognition, and insertion runs inside the
desktop process on the user's machine.

## What runs where

| Stage           | Process                  | Data path                                                                                         |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| Audio capture   | Renderer (Web Audio API) | `navigator.mediaDevices.getUserMedia` → `MediaStreamAudioSourceNode` → `ScriptProcessorNode`.     |
| Encoding        | Renderer                 | Float32 → 16 kHz mono int16 PCM, base64-encoded for IPC transport only.                           |
| Transcription   | Main process             | PCM written to a temp WAV (`os.tmpdir()`), fed to `whisper-cli` (whisper.cpp).                    |
| Model files     | Main process             | Downloaded from Hugging Face on first use, stored under `app.getPath('userData')/whisper-models`. |
| Composer insert | Renderer                 | The recognized text appears in the chat composer; the user reviews and can edit before sending.   |

The transcript is delivered to the renderer through the existing
`voice:stop-recording` IPC channel — no separate network call is made and no
audio buffer is persisted past the in-flight WAV file, which is deleted in the
`finally` block of `stopSessionAndTranscribe` (see
`apps/desktop/src/main/voice/manager.ts`).

## Guarantees

- **No cloud STT.** OpenCodex does not call OpenAI, AssemblyAI, Deepgram, Google,
  Azure, or any other hosted recognition API for voice input. The only network
  traffic the voice feature ever generates is the one-time model download from
  Hugging Face when the user explicitly selects a Whisper model in
  Settings → Accessibility → Voice input → Model → **Download**.
- **No auto-send.** The recognized text is inserted into the composer; sending
  is always an explicit user action (Enter, or clicking Send). Push-to-talk
  release stops capture and inserts text — it never submits a message.
- **No always-on listening.** Capture starts on push-to-talk press (default
  `Alt+Space`, configurable) or on explicit pointer-down on the mic button, and
  stops on release / pointer-up / pointer-cancel / pointer-leave.
- **Microphone permission is OS-level.** The user grants microphone access via
  the OS dialog the first time push-to-talk runs; OpenCodex inherits that
  permission and the user can revoke it from the OS settings at any time.
- **Audio never leaves the machine.** The temp WAV path is `os.tmpdir()` (a
  local OS-managed directory) and is removed after transcription completes or
  fails.
- **Local Only mode is compatible.** Voice input does not check the network
  allowlist because it does not make outbound requests, except for the
  user-initiated model download, which the allowlist gates exactly as it
  gates any other HTTPS request.

## Why no cloud STT in v1

OpenCodex is local-first by design. Cloud STT would mean shipping the user's
voice — frequently containing source-code snippets, customer names, API keys
they're about to paste, or other sensitive context — to a third party that
the user has not directly opted into for that data type. The provider-key
model that powers the LLM side does not transfer cleanly to STT: a cloud
STT vendor would need its own credentials, its own privacy review, and its own
retention story. Until those questions have a clear answer, we keep STT
in-process.

Local Whisper is also good enough for the dictation use case: `base.en` (142
MB) handles short prompts comfortably on a CPU, and `small.en` (466 MB) covers
longer commits and review comments. Users who want higher accuracy can opt
into a heavier model from the same panel.

## Implementation pointers

- Renderer button: `apps/desktop/src/renderer/components/VoiceInputButton.tsx`.
  Push-to-talk listener and audio downsampling live here.
- Composer wiring: `apps/desktop/src/renderer/views/ChatView.tsx` —
  `<VoiceInputButton onTranscript={text => setInput(prev => ...)}>` appends
  recognized text to the composer and never auto-sends.
- Main process: `apps/desktop/src/main/voice/manager.ts` (session lifecycle +
  cleanup) and `apps/desktop/src/main/voice/whisper-local.ts` (binary
  invocation + WAV writing).
- Settings UI: `apps/desktop/src/renderer/components/VoiceSettingsSection.tsx`,
  mounted from `apps/desktop/src/renderer/views/AccessibilityPanel.tsx`.
- IPC contracts: `apps/desktop/src/shared/voice.ts`.

## Future work (post-v1)

If hosted STT is ever added it must follow the existing provider pattern:
behind the `LLMProvider`-style abstraction with explicit user consent at
configuration time, an entry in the Local Only allowlist policy when the user
opts in, and an audit-log line per transcription. The default remains local.
