import { OnboardingBanner, PROVIDERS_SECTION_ID } from '../components/OnboardingBanner';
import { ApprovalsPanel } from './ApprovalsPanel';
import { AuditLogPanel } from './AuditLogPanel';
import { IndexingPanel } from './IndexingPanel';
import { ProvidersPanel } from './ProvidersPanel';
import { ThemePanel } from './ThemePanel';
import { WorkspacePanel } from './WorkspacePanel';

export function SettingsView(): JSX.Element {
  return (
    <section className="view settings-view">
      <header className="settings-section-head">
        <h1>Settings</h1>
        <p>Workspace, providers, approvals, MCP servers, plugins, theme, indexing.</p>
      </header>
      <OnboardingBanner />
      <section className="settings-section">
        <h2>Theme</h2>
        <p className="settings-section-desc">
          Light, dark, or follow the OS preference. Applied immediately.
        </p>
        <ThemePanel />
      </section>
      <section className="settings-section">
        <h2>Workspace</h2>
        <p className="settings-section-desc">
          Pick the folder the agent operates in. File-system tools (read, write, edit, glob, grep,
          run_shell) are sandboxed to this directory.
        </p>
        <WorkspacePanel />
      </section>
      <section className="settings-section" id={PROVIDERS_SECTION_ID}>
        <h2 tabIndex={-1}>Providers</h2>
        <p className="settings-section-desc">
          Add an API key to enable a provider. Keys are stored in your OS keychain; everything else
          lives in the local settings file.
        </p>
        <ProvidersPanel />
      </section>
      <section className="settings-section">
        <h2>Approvals</h2>
        <p className="settings-section-desc">
          Control which tool calls run automatically, which ask first, and which are blocked. Tier
          defaults apply to every tool in that tier; per-tool overrides take precedence.
        </p>
        <ApprovalsPanel />
      </section>
      <section className="settings-section">
        <h2>Audit log</h2>
        <p className="settings-section-desc">
          Every tool call the agent runs is recorded here. Filter by tool, decision, result, or time
          range. Click a row to inspect the input and output.
        </p>
        <AuditLogPanel />
      </section>
      <section className="settings-section">
        <h2>Indexing</h2>
        <p className="settings-section-desc">
          Codebase indexing for semantic search over your workspace.
        </p>
        <IndexingPanel />
      </section>
    </section>
  );
}
