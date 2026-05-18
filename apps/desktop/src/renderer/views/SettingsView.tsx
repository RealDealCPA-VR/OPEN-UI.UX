import { ProvidersPanel } from './ProvidersPanel';

export function SettingsView(): JSX.Element {
  return (
    <section className="view settings-view">
      <header className="settings-section-head">
        <h1>Settings</h1>
        <p>Providers, approvals, MCP servers, plugins, theme, indexing.</p>
      </header>
      <section className="settings-section">
        <h2>Providers</h2>
        <p className="settings-section-desc">
          Add an API key to enable a provider. Keys are stored in your OS keychain; everything else
          lives in the local settings file.
        </p>
        <ProvidersPanel />
      </section>
    </section>
  );
}
