import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ApprovalQueue } from './components/ApprovalQueue';
import { HoverHintProvider } from './components/HoverHint';
import { OnboardingWizard } from './components/OnboardingWizard';
import { PluginPanelHost } from './components/PluginPanelHost';
import { ThemeApplier } from './components/ThemeApplier';
import { ChatProvider } from './state/chat-context';
import { SelectedModelProvider } from './state/selected-model-context';
import { ChatView } from './views/ChatView';
import { AgentView } from './views/AgentView';
import { AutomationsView } from './views/AutomationsView';
import { CodebaseView } from './views/CodebaseView';
import { SettingsView } from './views/SettingsView';

export function App(): JSX.Element {
  const [hintsEnabled, setHintsEnabled] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    window.opencodex.settings
      .getHoverHintsEnabled()
      .then((value) => {
        if (!cancelled) setHintsEnabled(value);
      })
      .catch(() => {
        // Default stays `true` on failure — preserves the most discoverable UI.
      });
    const off = window.opencodex.settings.onHoverHintsChanged((value) => {
      if (!cancelled) setHintsEnabled(value);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return (
    <HashRouter>
      <HoverHintProvider enabled={hintsEnabled}>
        <SelectedModelProvider>
          <ChatProvider>
            <ThemeApplier />
            <DeepLinkRouter />
            <ApprovalQueue />
            <OnboardingWizard />
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Navigate to="/chat" replace />} />
                <Route path="/chat" element={<ChatView />} />
                <Route path="/agent" element={<AgentView />} />
                <Route path="/agent/:runId" element={<AgentView />} />
                <Route path="/codebase" element={<CodebaseView />} />
                <Route path="/automations" element={<AutomationsView />} />
                <Route path="/settings/scheduled-tasks" element={<ScheduledTasksRedirect />} />
                <Route path="/settings" element={<Navigate to="/settings/theme" replace />} />
                <Route path="/settings/:section" element={<SettingsView />} />
                <Route path="/plugins/:pluginId/:panelId" element={<PluginPanelHost />} />
                <Route path="*" element={<Navigate to="/chat" replace />} />
              </Route>
            </Routes>
          </ChatProvider>
        </SelectedModelProvider>
      </HoverHintProvider>
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

function ScheduledTasksRedirect(): JSX.Element {
  const location = useLocation();
  return <Navigate to={`/automations${location.search}`} replace />;
}

function parseDeepLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'opencodex:') return null;
    const host = url.hostname.replace(/^\/+|\/+$/g, '');
    const pathRest = url.pathname.replace(/^\/+|\/+$/g, '');
    const combined = [host, pathRest].filter((s) => s.length > 0).join('/');
    if (!combined) return null;
    return `/${combined}`;
  } catch {
    return null;
  }
}
