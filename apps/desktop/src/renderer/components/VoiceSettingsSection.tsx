import { useEffect, useState } from 'react';
import { HoverHint } from './HoverHint';
import {
  DEFAULT_PTT_SHORTCUT,
  DEFAULT_WHISPER_MODEL,
  WHISPER_MODEL_INFO,
  type DownloadProgressEvent,
  type WhisperModel,
} from '../../shared/voice';

interface BinaryStatus {
  found: boolean;
  path: string | null;
  version: string | null;
  setupHint: string | null;
}

export function VoiceSettingsSection(): JSX.Element {
  const [pttShortcut, setPttShortcut] = useState<string>(DEFAULT_PTT_SHORTCUT);
  const [pttDraft, setPttDraft] = useState<string>(DEFAULT_PTT_SHORTCUT);
  const [pttError, setPttError] = useState<string | null>(null);
  const [model, setModel] = useState<WhisperModel>(DEFAULT_WHISPER_MODEL);
  const [binaryStatus, setBinaryStatus] = useState<BinaryStatus | null>(null);
  const [configuredBinaryPath, setConfiguredBinaryPath] = useState<string>('');
  const [downloading, setDownloading] = useState<WhisperModel | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressEvent | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await window.opencodex.voice.getConfig();
        if (cancelled) return;
        setPttShortcut(cfg.pttShortcut);
        setPttDraft(cfg.pttShortcut);
        setModel(cfg.selectedModel);
        setConfiguredBinaryPath(cfg.binaryPath ?? '');
        const status = await window.opencodex.voice.checkBinary();
        if (!cancelled) setBinaryStatus(status);
      } catch {
        // Voice config is non-fatal.
      }
    })();
    const off = window.opencodex.voice.onDownloadProgress((ev) => {
      if (cancelled) return;
      setDownloadProgress(ev);
      if (ev.done) {
        setDownloading(null);
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const handleApplyShortcut = async (): Promise<void> => {
    setPttError(null);
    try {
      const res = await window.opencodex.voice.setPttShortcut(pttDraft);
      if (!res.registered && pttDraft.trim().length > 0) {
        setPttError(res.error ?? 'Could not register shortcut.');
      } else {
        setPttShortcut(res.accelerator);
      }
    } catch (err) {
      setPttError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSelectModel = async (next: WhisperModel): Promise<void> => {
    setModel(next);
    try {
      await window.opencodex.voice.setSelectedModel(next);
    } catch {
      // best effort
    }
  };

  const handleDownloadModel = async (m: WhisperModel): Promise<void> => {
    setDownloading(m);
    setDownloadProgress({ model: m, receivedBytes: 0, totalBytes: null, done: false, error: null });
    try {
      await window.opencodex.voice.downloadModel(m);
    } catch (err) {
      setDownloadProgress({
        model: m,
        receivedBytes: 0,
        totalBytes: null,
        done: true,
        error: err instanceof Error ? err.message : String(err),
      });
      setDownloading(null);
    }
  };

  const handleBinaryPathSave = async (): Promise<void> => {
    try {
      await window.opencodex.voice.setBinaryPath(
        configuredBinaryPath.trim().length === 0 ? null : configuredBinaryPath.trim(),
      );
      const status = await window.opencodex.voice.checkBinary();
      setBinaryStatus(status);
    } catch (err) {
      setBinaryStatus({
        found: false,
        path: null,
        version: null,
        setupHint: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <section className="voice-settings" data-settings-anchor="voice">
      <h3 className="voice-settings-title">Voice input</h3>
      <p className="voice-settings-desc">
        Push-to-talk dictation powered by a local whisper.cpp binary. Audio never leaves your
        machine.
      </p>

      <div className="voice-settings-row">
        <label className="voice-settings-label" htmlFor="voice-ptt-shortcut">
          Push-to-talk shortcut
        </label>
        <div className="voice-settings-inline">
          <input
            id="voice-ptt-shortcut"
            type="text"
            value={pttDraft}
            onChange={(e) => setPttDraft(e.target.value)}
            placeholder={DEFAULT_PTT_SHORTCUT}
            className="voice-settings-input"
          />
          <HoverHint hint="Save and register globally">
            <button type="button" className="btn" onClick={() => void handleApplyShortcut()}>
              Apply
            </button>
          </HoverHint>
        </div>
        {pttError ? (
          <p className="voice-settings-error">{pttError}</p>
        ) : (
          <p className="voice-settings-hint">
            Currently: <code>{pttShortcut || '(disabled)'}</code>. Use Electron accelerator syntax
            (e.g. <code>Alt+Space</code>, <code>CommandOrControl+Shift+V</code>). Leave blank to
            disable.
          </p>
        )}
      </div>

      <div className="voice-settings-row">
        <span className="voice-settings-label">Whisper binary</span>
        {binaryStatus?.found ? (
          <p className="voice-settings-hint">
            Found at <code>{binaryStatus.path}</code>
            {binaryStatus.version ? ` (${binaryStatus.version})` : ''}.
          </p>
        ) : (
          <p className="voice-settings-error">
            {binaryStatus?.setupHint ?? 'whisper-cli not found on PATH.'}
          </p>
        )}
        <div className="voice-settings-inline">
          <input
            type="text"
            value={configuredBinaryPath}
            onChange={(e) => setConfiguredBinaryPath(e.target.value)}
            placeholder="Optional: absolute path to whisper-cli"
            className="voice-settings-input"
          />
          <button type="button" className="btn" onClick={() => void handleBinaryPathSave()}>
            Save path
          </button>
        </div>
      </div>

      <div className="voice-settings-row">
        <span className="voice-settings-label">Model</span>
        <div className="voice-settings-models">
          {WHISPER_MODEL_INFO.map((info) => {
            const selected = model === info.id;
            const isDownloading = downloading === info.id;
            const progress =
              downloadProgress && downloadProgress.model === info.id ? downloadProgress : null;
            return (
              <div
                key={info.id}
                className={`voice-settings-model${selected ? ' voice-settings-model-selected' : ''}`}
              >
                <label className="voice-settings-model-pick">
                  <input
                    type="radio"
                    name="voice-model"
                    checked={selected}
                    onChange={() => void handleSelectModel(info.id)}
                  />
                  <span className="voice-settings-model-name">{info.displayName}</span>
                  <span className="voice-settings-model-size">{info.approxSizeMb} MB</span>
                </label>
                <p className="voice-settings-model-desc">{info.description}</p>
                <div className="voice-settings-inline">
                  <button
                    type="button"
                    className="btn"
                    disabled={isDownloading}
                    onClick={() => void handleDownloadModel(info.id)}
                  >
                    {isDownloading ? 'Downloading…' : 'Download'}
                  </button>
                  {progress && !progress.done && progress.totalBytes ? (
                    <span className="voice-settings-progress">
                      {Math.round((progress.receivedBytes / progress.totalBytes) * 100)}%
                    </span>
                  ) : null}
                  {progress?.error ? (
                    <span className="voice-settings-error">{progress.error}</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
