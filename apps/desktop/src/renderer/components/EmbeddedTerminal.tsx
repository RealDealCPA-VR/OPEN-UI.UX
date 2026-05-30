import { useEffect, useRef, useState } from 'react';
import { getBridge } from '../bridge';

interface EmbeddedTerminalProps {
  /** Chat stream id; filters incoming shell:output events. Empty disables stream filtering. */
  streamId: string;
  /** Tool-use id; filters incoming shell:output events */
  toolUseId: string;
  /**
   * One-shot replay content. Written verbatim into the terminal as soon as it mounts so the
   * captured run_shell output is visible immediately. Subsequent shell:output frames are
   * appended on top of it.
   */
  initialContent?: string;
}

function matchesStream(payloadStreamId: string, expected: string): boolean {
  if (expected === '') return true;
  return payloadStreamId === expected;
}

let xtermCssPromise: Promise<unknown> | null = null;

function loadXtermCss(): Promise<unknown> {
  if (!xtermCssPromise) {
    // CSS side-effect import — Vite handles the URL injection. Ignored in node/jsdom tests.
    xtermCssPromise = import(/* @vite-ignore */ '@xterm/xterm/css/xterm.css').catch(() => null);
  }
  return xtermCssPromise;
}

type TerminalHandle = {
  write(data: string): void;
  dispose(): void;
  fit(): void;
};

const FALLBACK_ROWS = 16;

export function EmbeddedTerminal({
  streamId,
  toolUseId,
  initialContent = '',
}: EmbeddedTerminalProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<TerminalHandle | null>(null);
  const pendingRef = useRef<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported'>('loading');

  useEffect(() => {
    let canceled = false;
    let unsubscribe: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;

    const host = hostRef.current;
    if (!host) {
      return;
    }

    void (async () => {
      try {
        const [xtermMod, fitMod] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
        ]);
        await loadXtermCss();
        if (canceled || !hostRef.current) return;

        const { Terminal } = xtermMod;
        const { FitAddon } = fitMod;
        const terminal = new Terminal({
          convertEol: false,
          cursorBlink: false,
          disableStdin: true,
          fontSize: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
          scrollback: 10_000,
          theme: { background: '#0b0d10' },
        });
        const fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(host);
        try {
          fit.fit();
        } catch {
          terminal.resize(80, FALLBACK_ROWS);
        }

        if (initialContent.length > 0) {
          terminal.write(initialContent);
        }
        for (const queued of pendingRef.current) {
          terminal.write(queued);
        }
        pendingRef.current = [];

        handleRef.current = {
          write: (data) => terminal.write(data),
          dispose: () => terminal.dispose(),
          fit: () => {
            try {
              fit.fit();
            } catch {
              // ignore — host may be detached during dispose
            }
          },
        };
        setStatus('ready');

        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => handleRef.current?.fit());
          resizeObserver.observe(host);
        }
      } catch (err) {
        if (!canceled) {
          setStatus('unsupported');
          console.error('failed to load xterm.js', err);
        }
      }
    })();

    const shellOutputSub = getBridge()?.chat.onShellOutput;
    if (shellOutputSub) {
      unsubscribe = shellOutputSub((payload) => {
        if (!matchesStream(payload.streamId, streamId)) return;
        if (payload.toolUseId !== toolUseId) return;
        const chunk = payload.chunk;
        if (handleRef.current) {
          handleRef.current.write(chunk);
        } else {
          pendingRef.current.push(chunk);
        }
      });
    }

    return () => {
      canceled = true;
      unsubscribe?.();
      resizeObserver?.disconnect();
      handleRef.current?.dispose();
      handleRef.current = null;
      pendingRef.current = [];
    };
  }, [streamId, toolUseId, initialContent]);

  return (
    <div className="embedded-terminal">
      {status === 'loading' ? <p className="embedded-terminal-status">Loading terminal…</p> : null}
      {status === 'unsupported' ? (
        <p className="embedded-terminal-status embedded-terminal-status-error">
          Terminal failed to load. The raw output is still available above.
        </p>
      ) : null}
      <div
        ref={hostRef}
        className="embedded-terminal-host"
        aria-label="Shell output (xterm)"
        role="presentation"
      />
    </div>
  );
}
