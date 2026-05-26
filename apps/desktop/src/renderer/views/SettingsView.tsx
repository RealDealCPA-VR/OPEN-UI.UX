import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { OnboardingBanner } from '../components/OnboardingBanner';
import { SettingsRail } from '../components/SettingsRail';
import { SettingsSectionCard } from '../components/SettingsSectionCard';
import { ApprovalsPanel } from './ApprovalsPanel';
import { AuditLogPanel } from './AuditLogPanel';
import { CrashReportingPanel } from './CrashReportingPanel';
import { IndexingPanel } from './IndexingPanel';
import { McpServersPanel } from './McpServersPanel';
import { MemoryPanel } from './MemoryPanel';
import { PluginsPanel } from './PluginsPanel';
import { ProvidersPanel } from './ProvidersPanel';
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
  const navigate = useNavigate();
  const { section: sectionParam } = useParams<{ section?: string }>();
  const [query, setQuery] = useState('');

  const defaultSection =
    findSectionBySlug(SETTINGS_SECTIONS, DEFAULT_SETTINGS_SLUG) ?? SETTINGS_SECTIONS[0];
  if (!defaultSection) throw new Error('SETTINGS_SECTIONS must have at least one entry');
  const currentSection: SettingsSection =
    findSectionBySlug(SETTINGS_SECTIONS, sectionParam ?? DEFAULT_SETTINGS_SLUG) ?? defaultSection;

  // If the URL slug is unknown (or missing), normalize to the resolved one.
  useEffect(() => {
    if (sectionParam !== currentSection.slug) {
      navigate(`/settings/${currentSection.slug}`, { replace: true });
    }
  }, [sectionParam, currentSection.slug, navigate]);

  const filtered = useMemo(() => filterSettingsSections(SETTINGS_SECTIONS, query), [query]);

  const handleSelect = useCallback(
    (slug: string) => {
      navigate(`/settings/${slug}`);
    },
    [navigate],
  );

  return (
    <section className="view settings-view settings-view-two-pane">
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
    case 'audit-log':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <AuditLogPanel />
        </SettingsSectionCard>
      );
    case 'indexing':
      return (
        <SettingsSectionCard title={section.title} description={section.description}>
          <IndexingPanel />
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
