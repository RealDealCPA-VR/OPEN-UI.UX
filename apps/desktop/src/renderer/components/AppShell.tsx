import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ModelPicker } from './ModelPicker';
import { StatusBar } from './StatusBar';

const NAV_ITEMS = [
  { to: '/chat', label: 'Chat' },
  { to: '/agent', label: 'Agent' },
  { to: '/codebase', label: 'Codebase' },
  { to: '/settings', label: 'Settings' },
] as const;

export function AppShell(): JSX.Element {
  const [version, setVersion] = useState<string>('?');

  useEffect(() => {
    window.opencodex.getVersion().then(setVersion).catch(console.error);
  }, []);

  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="Primary">
        <div className="sidebar-brand">OpenCodex</div>
        <ul className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">v{version}</div>
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
