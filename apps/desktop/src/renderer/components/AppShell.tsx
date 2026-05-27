import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { HoverHint } from './HoverHint';
import {
  LeftColumnContextPane,
  routeFromPathname,
  type LeftColumnRoute,
} from './LeftColumnContextPane';
import { ModelPicker } from './ModelPicker';
import { StatusBar } from './StatusBar';
import { useCollapseState } from '../state/use-collapse-state';

interface NavItem {
  to: string;
  label: string;
  hint: string;
  routeKey: LeftColumnRoute;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/chat', label: 'Chat', hint: 'Chat conversations', routeKey: 'chat' },
  { to: '/agent', label: 'Agent', hint: 'Agent runs', routeKey: 'agent' },
  { to: '/codebase', label: 'Codebase', hint: 'Browse codebase', routeKey: 'codebase' },
  {
    to: '/automations',
    label: 'Automations',
    hint: 'Scheduled automations',
    routeKey: 'automations',
  },
  { to: '/settings', label: 'Settings', hint: 'Open settings', routeKey: 'settings' },
];

export function AppShell(): JSX.Element {
  const [version, setVersion] = useState<string>('?');
  const [collapsed, toggleCollapsed] = useCollapseState('left-column', false);
  const location = useLocation();
  const activeRoute = useMemo(() => routeFromPathname(location.pathname), [location.pathname]);

  useEffect(() => {
    window.opencodex.getVersion().then(setVersion).catch(console.error);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.shiftKey || e.altKey) return;
      if (e.key === '\\') {
        e.preventDefault();
        toggleCollapsed();
        return;
      }
      if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleCollapsed]);

  const showContextPane = activeRoute !== 'settings';
  const shellClass = [
    'app-shell',
    'app-shell-unified',
    collapsed ? 'context-collapsed' : '',
    showContextPane ? '' : 'context-hidden',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={shellClass}>
      <nav className="sidebar nav-rail" aria-label="Primary">
        <div className="sidebar-head">
          <div className="sidebar-brand" aria-label="OpenCodex" />
        </div>
        <ul className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <HoverHint hint={item.hint} placement="right">
                <NavLink
                  to={item.to}
                  end={item.to === '/chat'}
                  className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}
                  aria-label={item.label}
                  title={item.label}
                >
                  <span className="sidebar-link-label">{item.label}</span>
                </NavLink>
              </HoverHint>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <HoverHint hint="Collapse left column" placement="right">
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand context pane' : 'Collapse context pane'}
              title={collapsed ? 'Expand (Ctrl/⌘+\\)' : 'Collapse (Ctrl/⌘+\\)'}
            >
              {collapsed ? '›' : '‹'}
            </button>
          </HoverHint>
          <span className="sidebar-version">v{version}</span>
        </div>
      </nav>
      <aside
        className="left-context-pane"
        aria-hidden={!showContextPane || collapsed}
        data-route={activeRoute}
      >
        {showContextPane && !collapsed ? <LeftColumnContextPane route={activeRoute} /> : null}
      </aside>
      <div className="main-column">
        <header className="topbar">
          <ModelPicker />
        </header>
        <main className="content">
          <Outlet />
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
