import { useEffect, useState } from 'react';
import { getBridge } from '../bridge';

// Linux-only window controls: with frame:false nothing draws
// minimize/maximize/close. win32 uses the native titleBarOverlay buttons and
// macOS keeps its inset traffic lights, so this renders null there.
export function WindowControls(): JSX.Element | null {
  const chrome = getBridge()?.windowChrome;
  const isLinux = chrome?.platform === 'linux';
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!chrome || !isLinux) return;
    let cancelled = false;
    chrome
      .isMaximized()
      .then((res) => {
        if (!cancelled) setMaximized(res.maximized);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [chrome, isLinux]);

  if (!chrome || !isLinux) return null;

  const handleToggleMaximize = (): void => {
    chrome
      .toggleMaximize()
      .then((res) => setMaximized(res.maximized))
      .catch(console.error);
  };

  return (
    <div className="window-controls" data-testid="window-controls">
      <button
        type="button"
        className="window-control-btn"
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => void chrome.minimize()}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 6h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="window-control-btn"
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={handleToggleMaximize}
      >
        {maximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M4 4V2.5h5.5V8H8M2.5 4H8v5.5H2.5V4Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <rect
              x="2.5"
              y="2.5"
              width="7"
              height="7"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="window-control-btn window-control-close"
        aria-label="Close window"
        title="Close"
        onClick={() => void chrome.close()}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M3 3l6 6M9 3l-6 6"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
