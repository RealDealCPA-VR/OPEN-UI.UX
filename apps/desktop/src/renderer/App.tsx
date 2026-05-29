import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ApprovalQueue } from './components/ApprovalQueue';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HoverHintProvider } from './components/HoverHint';
import { OnboardingWizard } from './components/OnboardingWizard';
import { PluginPanelHost } from './components/PluginPanelHost';
import { ThemeApplier } from './components/ThemeApplier';
import { ToastProvider, useToast } from './components/Toasts';
import { ChatProvider } from './state/chat-context';
import { SelectedModelProvider } from './state/selected-model-context';
import { ChatView } from './views/ChatView';
import { AgentView } from './views/AgentView';
import { AutomationsView } from './views/AutomationsView';
import { CodebaseView } from './views/CodebaseView';
import { ReviewView } from './views/ReviewView';
import { RunnersView } from './views/RunnersView';
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
        <ToastProvider>
          <SelectedModelProvider>
            <ChatProvider>
              <ThemeApplier />
              <DeepLinkRouter />
              <UiErrorBridge />
              <ApprovalQueue />
              <OnboardingWizard />
              <Routes>
                <Route
                  element={
                    <ErrorBoundary label="AppShell">
                      <AppShell />
                    </ErrorBoundary>
                  }
                >
                  <Route index element={<Navigate to="/chat" replace />} />
                  <Route
                    path="/chat"
                    element={
                      <ErrorBoundary label="ChatView">
                        <ChatView />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/agent"
                    element={
                      <ErrorBoundary label="AgentView">
                        <AgentView />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/agent/:runId"
                    element={
                      <ErrorBoundary label="AgentView">
                        <AgentView />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/codebase"
                    element={
                      <ErrorBoundary label="CodebaseView">
                        <CodebaseView />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/review"
                    element={
                      <ErrorBoundary label="ReviewView">
                        <ReviewView />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/automations"
                    element={
                      <ErrorBoundary label="AutomationsView">
                        <AutomationsView />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/runners"
                    element={
                      <ErrorBoundary label="RunnersView">
                        <RunnersView />
                      </ErrorBoundary>
                    }
                  />
                  <Route path="/settings/runners" element={<RunnersRedirect />} />
                  <Route path="/settings/scheduled-tasks" element={<ScheduledTasksRedirect />} />
                  <Route path="/settings" element={<Navigate to="/settings/theme" replace />} />
                  <Route
                    path="/settings/:section"
                    element={
                      <ErrorBoundary label="SettingsView">
                        <SettingsView />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/plugins/:pluginId/:panelId"
                    element={
                      <ErrorBoundary label="PluginPanelHost">
                        <PluginPanelHost />
                      </ErrorBoundary>
                    }
                  />
                  <Route path="*" element={<Navigate to="/chat" replace />} />
                </Route>
              </Routes>
            </ChatProvider>
          </SelectedModelProvider>
        </ToastProvider>
      </HoverHintProvider>
    </HashRouter>
  );
}

function UiErrorBridge(): null {
  const toast = useToast();
  useEffect(() => {
    return window.opencodex.ui.onError((payload) => {
      const kind =
        payload.severity === 'error' ? 'error' : payload.severity === 'warning' ? 'warn' : 'info';
      toast.show(`${payload.source}: ${payload.message}`, { kind });
    });
  }, [toast]);
  return null;
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

function RunnersRedirect(): JSX.Element {
  const location = useLocation();
  return <Navigate to={`/runners${location.search}${location.hash}`} replace />;
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
