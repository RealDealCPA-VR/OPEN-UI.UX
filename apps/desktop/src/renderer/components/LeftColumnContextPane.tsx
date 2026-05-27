import { lazy, Suspense } from 'react';

const ChatContextPane = lazy(() => import('./left-column-panes/ChatContextPane'));
const AgentContextPane = lazy(() => import('./left-column-panes/AgentContextPane'));
const CodebaseContextPane = lazy(() => import('./left-column-panes/CodebaseContextPane'));
const AutomationsContextPane = lazy(() => import('./left-column-panes/AutomationsContextPane'));

export type LeftColumnRoute = 'chat' | 'agent' | 'codebase' | 'automations' | 'settings';

export function routeFromPathname(pathname: string): LeftColumnRoute {
  if (pathname.startsWith('/agent')) return 'agent';
  if (pathname.startsWith('/codebase')) return 'codebase';
  if (pathname.startsWith('/automations')) return 'automations';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'chat';
}

export interface LeftColumnContextPaneProps {
  route: LeftColumnRoute;
}

export function LeftColumnContextPane({ route }: LeftColumnContextPaneProps): JSX.Element | null {
  if (route === 'settings') {
    // SettingsView has its own two-pane layout with the section rail —
    // duplicating that here would be noise, so we render nothing.
    return null;
  }
  return (
    <Suspense fallback={<div className="pane-loading" aria-hidden="true" />}>
      {route === 'chat' && <ChatContextPane />}
      {route === 'agent' && <AgentContextPane />}
      {route === 'codebase' && <CodebaseContextPane />}
      {route === 'automations' && <AutomationsContextPane />}
    </Suspense>
  );
}
