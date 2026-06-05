import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AgentResumePrompt } from './AgentResumePrompt';
import { CommandPalette } from './CommandPalette';
import { HoverHint } from './HoverHint';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import {
  LeftColumnContextPane,
  routeFromPathname,
  type LeftColumnRoute,
} from './LeftColumnContextPane';
import { LocalOnlyPill } from './LocalOnlyPill';
import { McpToolRunner } from './McpToolRunner';
import { StatusBar } from './StatusBar';
import { useCollapseState } from '../state/use-collapse-state';
import { getBridge } from '../bridge';
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
    to: '/review',
    label: 'Reviewer',
    hint: 'Diff-based code reviews',
    shortcut: '⌘5',
    routeKey: 'review',
  },
  {
    to: '/automations',
    label: 'Automations',
    hint: 'Scheduled automations',
    shortcut: '⌘6',
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const activeRoute = useMemo(() => routeFromPathname(location.pathname), [location.pathname]);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    bridge.getVersion().then(setVersion).catch(console.error);
  }, []);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (target.isContentEditable) return true;
      return false;
    };
    const onKey = (e: KeyboardEvent): void => {
      // '?' opens the shortcuts cheatsheet (when not typing in a field).
      // Shift+/ produces '?' on US layouts; other layouts may produce '?' without shift.
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.shiftKey || e.altKey) return;
      // Lane 3 — global command palette
      if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
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
      <a
        href="#main-content"
        className="skip-to-main"
        onClick={(e) => {
          e.preventDefault();
          const main = document.getElementById('main-content');
          if (main) {
            main.focus({ preventScroll: false });
            main.scrollIntoView({ block: 'start' });
          }
        }}
      >
        Skip to main content
      </a>
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
                <svg
                  className={
                    collapsed ? 'sidebar-chevron sidebar-chevron-collapsed' : 'sidebar-chevron'
                  }
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M10 4L6 8l4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
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
          <HoverHint hint="Keyboard shortcuts" shortcut="?" placement="right">
            <button
              type="button"
              className="sidebar-help-link"
              aria-label="Show keyboard shortcuts"
              onClick={() => setShortcutsOpen(true)}
            >
              ?
            </button>
          </HoverHint>
          <span className="sidebar-version">v{version}</span>
        </div>
      </aside>
      <div className="main-column">
        <div className="main-column-header" role="presentation">
          <LocalOnlyPill />
        </div>
        <main id="main-content" className="content" tabIndex={-1}>
          <Outlet />
        </main>
        <StatusBar />
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <AgentResumePrompt />
      <McpToolRunner />
    </div>
  );
}
