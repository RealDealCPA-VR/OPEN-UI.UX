import { lazy, Suspense } from 'react';
import { JobsPane } from './JobsPane';

const ChatContextPane = lazy(() => import('./left-column-panes/ChatContextPane'));
const AgentContextPane = lazy(() => import('./left-column-panes/AgentContextPane'));
const CodebaseContextPane = lazy(() => import('./left-column-panes/CodebaseContextPane'));
const AutomationsContextPane = lazy(() => import('./left-column-panes/AutomationsContextPane'));

export type LeftColumnRoute =
  | 'chat'
  | 'agent'
  | 'codebase'
  | 'review'
  | 'automations'
  | 'runners'
  | 'settings';

export function routeFromPathname(pathname: string): LeftColumnRoute {
  if (pathname.startsWith('/agent')) return 'agent';
  if (pathname.startsWith('/codebase')) return 'codebase';
  if (pathname.startsWith('/review')) return 'review';
  if (pathname.startsWith('/automations')) return 'automations';
  if (pathname.startsWith('/runners')) return 'runners';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'chat';
}

export interface LeftColumnContextPaneProps {
  route: LeftColumnRoute;
}

export function LeftColumnContextPane({ route }: LeftColumnContextPaneProps): JSX.Element | null {
  if (route === 'settings' || route === 'runners' || route === 'review') {
    // SettingsView, RunnersView, and ReviewView own their own headers/layout —
    // no left context pane to render.
    return null;
  }
  return (
    <Suspense fallback={<div className="pane-loading" aria-hidden="true" />}>
      {route === 'chat' && <ChatContextPane />}
      {route === 'agent' && (
        <>
          <AgentContextPane />
          <JobsPane />
        </>
      )}
      {route === 'codebase' && <CodebaseContextPane />}
      {route === 'automations' && <AutomationsContextPane />}
    </Suspense>
  );
}
