import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ChatView } from './views/ChatView';
import { AgentView } from './views/AgentView';
import { CodebaseView } from './views/CodebaseView';
import { SettingsView } from './views/SettingsView';

export function App(): JSX.Element {
  return (
    <HashRouter>
      <DeepLinkRouter />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatView />} />
          <Route path="/agent" element={<AgentView />} />
          <Route path="/codebase" element={<CodebaseView />} />
          <Route path="/settings" element={<SettingsView />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

function DeepLinkRouter(): null {
  const navigate = useNavigate();
  useEffect(() => {
    return window.opencodex.onDeepLink((url) => {
      const path = parseDeepLink(url);
      if (path) navigate(path);
    });
  }, [navigate]);
  return null;
}

function parseDeepLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'opencodex:') return null;
    const segment = url.hostname || url.pathname.replace(/^\/+/, '');
    if (!segment) return null;
    return `/${segment}`;
  } catch {
    return null;
  }
}
