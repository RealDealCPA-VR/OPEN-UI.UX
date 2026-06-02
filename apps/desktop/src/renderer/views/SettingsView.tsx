import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { OnboardingBanner } from '../components/OnboardingBanner';
import { SettingsRail } from '../components/SettingsRail';
import { SettingsSectionCard } from '../components/SettingsSectionCard';
import { AccessibilityPanel } from './AccessibilityPanel';
import { AntiSycophancyToggle } from './AntiSycophancyToggle';
import { ApprovalsPanel } from './ApprovalsPanel';
import { AuditLogPanel } from './AuditLogPanel';
import { BudgetsPanel } from './BudgetsPanel';
import { CrashReportingPanel } from './CrashReportingPanel';
import { HelpPanel } from './HelpPanel';
import { IndexingPanel } from './IndexingPanel';
import { LocalFsMemoryPanel } from './LocalFsMemoryPanel';
import { McpServersPanel } from './McpServersPanel';
import { MemoryPanel } from './MemoryPanel';
import { PluginsPanel } from './PluginsPanel';
import { PrivacyPanel } from './PrivacyPanel';
import { ProvidersPanel } from './ProvidersPanel';
import { ReplayPanel } from './ReplayPanel';
import { RoutingPanel } from './RoutingPanel';
import { ScheduledTasksPanel } from './ScheduledTasksPanel';
import { SkillsPanel } from './SkillsPanel';
import {
  DEFAULT_SETTINGS_SLUG,
  filterSettingsSections,
  findSectionBySlug,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from './settings-sections';
import { TelemetryPanel } from './TelemetryPanel';
import { ThemePanel } from './ThemePanel';
import { UpdatesPanel } from './UpdatesPanel';
import { WorkspacePanel } from './WorkspacePanel';

export function SettingsView(): JSX.Element {
  const defaultSection =
    findSectionBySlug(SETTINGS_SECTIONS, DEFAULT_SETTINGS_SLUG) ?? SETTINGS_SECTIONS[0];
  if (!defaultSection) {
    return (
      <div role="alert" style={{ padding: 24 }}>
        <h1 style={{ marginTop: 0 }}>Settings unavailable</h1>
        <p>
          No settings sections are registered. This indicates a build configuration problem — please
          reinstall OpenCodex or contact support.
        </p>
      </div>
    );
  }
  return <SettingsViewBody defaultSection={defaultSection} />;
}

function SettingsViewBody({ defaultSection }: { defaultSection: SettingsSection }): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { section: sectionParam } = useParams<{ section?: string }>();
  const [query, setQuery] = useState('');

  const currentSection: SettingsSection =
    findSectionBySlug(SETTINGS_SECTIONS, sectionParam ?? DEFAULT_SETTINGS_SLUG) ?? defaultSection;

  // If the URL slug is unknown (or missing), normalize to the resolved one.
  useEffect(() => {
    if (sectionParam !== currentSection.slug) {
      navigate(`/settings/${currentSection.slug}`, { replace: true });
    }
  }, [sectionParam, currentSection.slug, navigate]);

  // Deep-link anchor: read ?highlight=<anchor> or #row=<anchor>, briefly
  // outline the matching [data-settings-anchor] element after the panel mounts.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('highlight');
    const fromHash = location.hash.startsWith('#row=')
      ? decodeURIComponent(location.hash.slice('#row='.length))
      : null;
    const anchor = fromQuery ?? fromHash;
    if (!anchor) return;
    let cancelled = false;
    let innerHandle: number | null = null;
    let highlightedEl: HTMLElement | null = null;
    const handle = window.setTimeout(() => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(
        `[data-settings-anchor="${CSS.escape(anchor)}"]`,
      );
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('settings-anchor-highlight');
      highlightedEl = el;
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const ms = prefersReduced ? 0 : 1600;
      innerHandle = window.setTimeout(() => {
        el.classList.remove('settings-anchor-highlight');
        highlightedEl = null;
      }, ms);
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
      if (innerHandle !== null) window.clearTimeout(innerHandle);
      if (highlightedEl) highlightedEl.classList.remove('settings-anchor-highlight');
    };
  }, [location.search, location.hash, currentSection.slug]);

  const filtered = useMemo(() => filterSettingsSections(SETTINGS_SECTIONS, query), [query]);

  const handleSelect = useCallback(
    (slug: string) => {
      navigate(`/settings/${slug}`);
    },
    [navigate],
  );

  return (
    <section className="view settings-view settings-view-two-pane" aria-labelledby="settings-h1">
      <style>{ANCHOR_HIGHLIGHT_CSS}</style>
      <h1 id="settings-h1" className="sr-only">
        Settings
      </h1>
      <SettingsRail
        sections={filtered}
        activeSlug={currentSection.slug}
        onSelect={handleSelect}
        query={query}
        onQueryChange={setQuery}
      />
      <div className="settings-pane">
        <OnboardingBanner />
        <SettingsSectionBody section={currentSection} />
      </div>
    </section>
  );
}

const ANCHOR_HIGHLIGHT_CSS = `
  .settings-anchor-highlight {
    animation: settings-anchor-pulse 1.6s ease-out 1;
    border-radius: 6px;
  }
  @keyframes settings-anchor-pulse {
    0%   { box-shadow: 0 0 0 0 var(--accent-soft-border); }
    20%  { box-shadow: 0 0 0 4px var(--accent-soft-border); }
    100% { box-shadow: 0 0 0 0 transparent; }
  }
  @media (prefers-reduced-motion: reduce) {
    .settings-anchor-highlight { animation: none; outline: 2px solid var(--accent); outline-offset: 2px; }
  }
`;

function SettingsSectionBody({ section }: { section: SettingsSection }): JSX.Element {
  switch (section.slug) {
    case 'theme':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <ThemePanel />
        </SettingsSectionCard>
      );
    case 'workspace':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <WorkspacePanel />
        </SettingsSectionCard>
      );
    case 'providers':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <ProvidersPanel />
        </SettingsSectionCard>
      );
    case 'approvals':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <ApprovalsPanel />
          <AntiSycophancyToggle />
        </SettingsSectionCard>
      );
    case 'routing':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <RoutingPanel />
        </SettingsSectionCard>
      );
    case 'privacy':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <PrivacyPanel />
        </SettingsSectionCard>
      );
    case 'plugins':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <PluginsPanel />
        </SettingsSectionCard>
      );
    case 'mcp':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <McpServersPanel />
        </SettingsSectionCard>
      );
    case 'memory':
      return <MemorySection section={section} />;
    case 'updates':
      return <UpdatesSection section={section} />;
    case 'telemetry':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <TelemetryPanel />
        </SettingsSectionCard>
      );
    case 'crash-reporting':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <CrashReportingPanel />
        </SettingsSectionCard>
      );
    case 'budgets':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <BudgetsPanel />
        </SettingsSectionCard>
      );
    case 'audit-log':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <AuditLogPanel />
        </SettingsSectionCard>
      );
    case 'replay':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <ReplayPanel />
        </SettingsSectionCard>
      );
    case 'indexing':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <IndexingPanel />
        </SettingsSectionCard>
      );
    case 'scheduled-tasks':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <ScheduledTasksPanel />
        </SettingsSectionCard>
      );
    case 'skills':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <SkillsPanel />
        </SettingsSectionCard>
      );
    case 'accessibility':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <AccessibilityPanel />
        </SettingsSectionCard>
      );
    case 'help':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <HelpPanel />
        </SettingsSectionCard>
      );
    default:
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <p className="chat-empty">Unknown section.</p>
        </SettingsSectionCard>
      );
  }
}

function MemorySection({ section }: { section: SettingsSection }): JSX.Element {
  const [reloading, setReloading] = useState(false);
  const handleReload = async (): Promise<void> => {
    setReloading(true);
    try {
      await window.opencodex.memory.reload();
    } catch {
      // Surface via the panel's own status pills — nothing else to do here.
    } finally {
      setReloading(false);
    }
  };
  return (
    <SettingsSectionCard
      title={section.title}
      description={section.description}
      actions={
        <button
          type="button"
          className="btn"
          onClick={() => void handleReload()}
          disabled={reloading}
        >
          {reloading ? 'Reloading…' : 'Reload'}
        </button>
      }
    >
      <MemoryPanel />
      <LocalFsMemoryPanel />
    </SettingsSectionCard>
  );
}

function UpdatesSection({ section }: { section: SettingsSection }): JSX.Element {
  const checkRef = useRef<(() => void) | null>(null);
  return (
    <SettingsSectionCard
      title={section.title}
      description={section.description}
      actions={
        <button type="button" className="btn" onClick={() => checkRef.current?.()}>
          Check now
        </button>
      }
    >
      <UpdatesPanel
        onCheckRef={(fn) => {
          checkRef.current = fn;
        }}
      />
    </SettingsSectionCard>
  );
}
