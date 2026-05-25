import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ModelPicker } from './ModelPicker';
import { StatusBar } from './StatusBar';
import { useCollapseState } from '../state/use-collapse-state';

const NAV_ITEMS = [
  { to: '/chat', label: 'Chat' },
  { to: '/agent', label: 'Agent' },
  { to: '/codebase', label: 'Codebase' },
  { to: '/settings', label: 'Settings' },
] as const;

export function AppShell(): JSX.Element {
  const [version, setVersion] = useState<string>('?');
  const [collapsed, toggleCollapsed] = useCollapseState('opencodex.nav.collapsed', false);

  useEffect(() => {
    window.opencodex.getVersion().then(setVersion).catch(console.error);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleCollapsed]);

  return (
    <div className={collapsed ? 'app-shell nav-collapsed' : 'app-shell'}>
      <nav className={collapsed ? 'sidebar collapsed' : 'sidebar'} aria-label="Primary">
        <div className="sidebar-head">
          {collapsed ? null : <div className="sidebar-brand">OpenCodex</div>}
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand (Ctrl/⌘+B)' : 'Collapse (Ctrl/⌘+B)'}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>
        <ul className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}
                title={collapsed ? item.label : undefined}
              >
                <span className="sidebar-link-label">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">{collapsed ? '' : `v${version}`}</div>
      </nav>
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
