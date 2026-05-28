import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { HoverHint } from './HoverHint';
import {
  LeftColumnContextPane,
  routeFromPathname,
  type LeftColumnRoute,
} from './LeftColumnContextPane';
import { StatusBar } from './StatusBar';
import { useCollapseState } from '../state/use-collapse-state';
import brandLogoUrl from '../assets/brand.png';

interface NavItem {
  to: string;
  label: string;
  hint: string;
  shortcut: string;
  routeKey: LeftColumnRoute;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/chat', label: 'Chat', hint: 'Chat conversations', shortcut: '⌘1', routeKey: 'chat' },
  { to: '/agent', label: 'Agent', hint: 'Agent runs', shortcut: '⌘2', routeKey: 'agent' },
  {
    to: '/runners',
    label: 'Runners',
    hint: 'Configure agent runners',
    shortcut: '⌘3',
    routeKey: 'runners',
  },
  {
    to: '/codebase',
    label: 'Codebase',
    hint: 'Browse codebase',
    shortcut: '⌘4',
    routeKey: 'codebase',
  },
  {
    to: '/automations',
    label: 'Automations',
    hint: 'Scheduled automations',
    shortcut: '⌘5',
    routeKey: 'automations',
  },
  {
    to: '/settings',
    label: 'Settings',
    hint: 'Open settings',
    shortcut: '⌘,',
    routeKey: 'settings',
  },
];

export function AppShell(): JSX.Element {
  const [version, setVersion] = useState<string>('?');
  const [collapsed, toggleCollapsed] = useCollapseState('left-column', false);
  const location = useLocation();
  const navigate = useNavigate();
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
        return;
      }
      if (e.key === ',') {
        e.preventDefault();
        navigate('/settings');
        return;
      }
      if (e.key >= '1' && e.key <= '6') {
        const idx = Number.parseInt(e.key, 10) - 1;
        const dest = NAV_ITEMS[idx];
        if (dest) {
          e.preventDefault();
          navigate(dest.to);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleCollapsed, navigate]);

  const shellClass = ['app-shell', 'app-shell-unified', collapsed ? 'context-collapsed' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={shellClass}>
      <aside className="left-column" data-route={activeRoute}>
        <nav className="sidebar nav-rail" aria-label="Primary">
          <div className="sidebar-head">
            <img className="sidebar-brand" src={brandLogoUrl} alt="OpenCodex" />
            <HoverHint hint={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
              <button
                type="button"
                className="sidebar-collapse-btn"
                onClick={toggleCollapsed}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={collapsed ? 'Expand (Ctrl/⌘+\\)' : 'Collapse (Ctrl/⌘+\\)'}
              >
                {collapsed ? '›' : '‹'}
              </button>
            </HoverHint>
          </div>
          <ul className="sidebar-nav">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <HoverHint hint={item.hint} shortcut={item.shortcut} placement="right">
                  <NavLink
                    to={item.to}
                    end={item.to === '/chat'}
                    className={({ isActive }) =>
                      isActive ? 'sidebar-link active' : 'sidebar-link'
                    }
                    aria-label={item.label}
                    title={item.label}
                  >
                    <span className="sidebar-link-label">{item.label}</span>
                  </NavLink>
                </HoverHint>
              </li>
            ))}
          </ul>
        </nav>
        {!collapsed && activeRoute !== 'settings' ? (
          <div className="left-context-pane" data-route={activeRoute}>
            <LeftColumnContextPane route={activeRoute} />
          </div>
        ) : null}
        <div className="sidebar-footer">
          <HoverHint hint="Open user manual" placement="right">
            <Link to="/settings/help" className="sidebar-help-link" aria-label="Help">
              ?
            </Link>
          </HoverHint>
          <span className="sidebar-version">v{version}</span>
        </div>
      </aside>
      <div className="main-column">
        <main className="content">
          <Outlet />
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
