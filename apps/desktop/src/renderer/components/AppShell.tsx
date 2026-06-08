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
import { deriveInbox } from '../views/agent-runs-derive';
import brandLogoUrl from '../assets/brand.png';

type NavZone = 'primary' | 'tools' | 'settings';

interface NavItem {
  to: string;
  label: string;
  hint: string;
  shortcut: string;
  routeKey: LeftColumnRoute;
  zone: NavZone;
}

// NOTE: array order (and therefore the ⌘1–⌘6 index mapping in the keydown
// handler) is intentionally unchanged. `zone` only drives visual grouping so
// the rail reads as a content-first primary set + a quieter tools set, without
// renumbering any shortcut.
const NAV_ITEMS: readonly NavItem[] = [
  {
    to: '/chat',
    label: 'Chat',
    hint: 'Chat conversations',
    shortcut: '⌘1',
    routeKey: 'chat',
    zone: 'primary',
  },
  {
    to: '/agent',
    label: 'Agent',
    hint: 'Agent runs',
    shortcut: '⌘2',
    routeKey: 'agent',
    zone: 'primary',
  },
  {
    to: '/runners',
    label: 'Runners',
    hint: 'Configure agent runners',
    shortcut: '⌘3',
    routeKey: 'runners',
    zone: 'tools',
  },
  {
    to: '/codebase',
    label: 'Codebase',
    hint: 'Browse codebase',
    shortcut: '⌘4',
    routeKey: 'codebase',
    zone: 'primary',
  },
  {
    to: '/review',
    label: 'Reviewer',
    hint: 'Diff-based code reviews',
    shortcut: '⌘5',
    routeKey: 'review',
    zone: 'tools',
  },
  {
    to: '/automations',
    label: 'Automations',
    hint: 'Scheduled automations',
    shortcut: '⌘6',
    routeKey: 'automations',
    zone: 'tools',
  },
  {
    to: '/settings',
    label: 'Settings',
    hint: 'Open settings',
    shortcut: '⌘,',
    routeKey: 'settings',
    zone: 'settings',
  },
];

const PRIMARY_ITEMS = NAV_ITEMS.filter((i) => i.zone === 'primary');
const TOOL_ITEMS = NAV_ITEMS.filter((i) => i.zone === 'tools');
const SETTINGS_ITEM = NAV_ITEMS.find((i) => i.zone === 'settings');

export function AppShell(): JSX.Element {
  const [version, setVersion] = useState<string>('?');
  const [collapsed, toggleCollapsed] = useCollapseState('left-column', false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const activeRoute = useMemo(() => routeFromPathname(location.pathname), [location.pathname]);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    bridge.getVersion().then(setVersion).catch(console.error);
  }, []);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    bridge.agent
      .listRuns()
      .then((runs) => {
        if (!cancelled) setUnreadCount(deriveInbox(runs).unreadCount);
      })
      .catch(() => {
        // Non-fatal — badge just stays hidden if runs can't load.
      });
    const off = bridge.agent.onRunsChanged((payload) => {
      setUnreadCount(deriveInbox(payload.runs).unreadCount);
    });
    return () => {
      cancelled = true;
      off();
    };
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

  const renderNavItem = (item: NavItem): JSX.Element => {
    const linkClass = item.zone === 'tools' ? 'sidebar-link sidebar-link-tool' : 'sidebar-link';
    return (
      <li key={item.to}>
        <HoverHint hint={item.hint} shortcut={item.shortcut} placement="right">
          <NavLink
            to={item.to}
            end={item.to === '/chat'}
            className={({ isActive }) => (isActive ? `${linkClass} active` : linkClass)}
            aria-label={
              item.routeKey === 'agent' && unreadCount > 0
                ? `${item.label} (${unreadCount} unread)`
                : item.label
            }
            title={item.label}
          >
            <span className="sidebar-link-label">{item.label}</span>
            {item.routeKey === 'agent' && unreadCount > 0 && (
              <span className="badge nav-badge" aria-hidden="true">
                {unreadCount}
              </span>
            )}
          </NavLink>
        </HoverHint>
      </li>
    );
  };

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
            {PRIMARY_ITEMS.map(renderNavItem)}
            <li className="nav-rail-divider" aria-hidden="true" />
            {TOOL_ITEMS.map(renderNavItem)}
            {SETTINGS_ITEM ? (
              <>
                <li className="nav-rail-divider nav-rail-divider-settings" aria-hidden="true" />
                {renderNavItem(SETTINGS_ITEM)}
              </>
            ) : null}
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
