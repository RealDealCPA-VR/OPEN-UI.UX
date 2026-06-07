import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Skill, SkillRegistryEntry } from '../../shared/skills';

export function SkillsPanel(): JSX.Element {
  const navigate = useNavigate();
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillScope, setNewSkillScope] = useState<'user' | 'project'>('user');
  const [importUrl, setImportUrl] = useState('');
  const [registryExpanded, setRegistryExpanded] = useState(false);
  const [registryUrl, setRegistryUrl] = useState<string>('');
  const [savedRegistryUrl, setSavedRegistryUrl] = useState<string | null>(null);
  const [registryEntries, setRegistryEntries] = useState<SkillRegistryEntry[] | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [registryBusy, setRegistryBusy] = useState(false);
  const [importConfirmPending, setImportConfirmPending] = useState(false);
  const [installConfirmEntry, setInstallConfirmEntry] = useState<SkillRegistryEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    const off = window.opencodex.skills.onChanged((payload) => {
      setSkills(payload.skills);
    });
    window.opencodex.skills
      .list()
      .then((res) => {
        if (!cancelled) setSkills(res.skills);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const toggleEnabled = useCallback(async (skill: Skill) => {
    setBusy(skill.id);
    setActionError(null);
    try {
      await window.opencodex.skills.setEnabled({ id: skill.id, enabled: skill.disabled });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  const openInEditor = useCallback(async (skill: Skill) => {
    setBusy(skill.id);
    setActionError(null);
    try {
      const res = await window.opencodex.skills.openInEditor({ id: skill.id });
      if (!res.ok) setActionError(res.error ?? 'Failed to open');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  const createSkill = useCallback(async () => {
    const trimmed = newSkillName.trim();
    if (!trimmed) {
      setActionError('Skill name is required');
      return;
    }
    setBusy('__new');
    setActionError(null);
    try {
      await window.opencodex.skills.createFromTemplate({
        name: trimmed,
        scope: newSkillScope,
      });
      setNewSkillName('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [newSkillName, newSkillScope]);

  const importSkill = useCallback(async () => {
    const url = importUrl.trim();
    if (!url) {
      setActionError('URL is required');
      return;
    }
    if (!/^https:\/\//i.test(url)) {
      setActionError('Only https:// URLs are allowed');
      return;
    }
    setImportConfirmPending(true);
  }, [importUrl]);

  const confirmImportSkill = useCallback(async () => {
    const url = importUrl.trim();
    setImportConfirmPending(false);
    setBusy('__import');
    setActionError(null);
    try {
      await window.opencodex.skills.importFromUrl({ url });
      setImportUrl('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [importUrl]);

  const scheduleSkill = useCallback(
    (skill: Skill) => {
      // Navigate to the Scheduled Tasks panel; ScheduledTasksPanel reads the
      // ?prefillSkill query param on mount and opens its editor pre-filled.
      navigate(`/settings/scheduled-tasks?prefillSkill=${encodeURIComponent(skill.id)}`);
    },
    [navigate],
  );

  // Load the persisted registry URL once. Don't auto-fetch on mount — the user
  // has to explicitly Expand + Refresh, so we never make a network request
  // without consent.
  useEffect(() => {
    void window.opencodex.skills
      .getRegistryUrl()
      .then((res) => {
        setSavedRegistryUrl(res.url);
        if (res.url) setRegistryUrl(res.url);
      })
      .catch(() => undefined);
  }, []);

  const [registrySaved, setRegistrySaved] = useState(false);

  const saveRegistryUrl = useCallback(async () => {
    setRegistryBusy(true);
    setRegistryError(null);
    try {
      const trimmed = registryUrl.trim();
      const value = trimmed.length > 0 ? trimmed : null;
      if (value && !/^https:\/\//i.test(value)) {
        setRegistryError('Only https:// URLs are allowed.');
        return;
      }
      const res = await window.opencodex.skills.setRegistryUrl(value);
      setSavedRegistryUrl(res.url);
      setRegistrySaved(true);
      window.setTimeout(() => setRegistrySaved(false), 1200);
    } catch (err) {
      setRegistryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegistryBusy(false);
    }
  }, [registryUrl]);

  const refreshRegistry = useCallback(async () => {
    setRegistryBusy(true);
    setRegistryError(null);
    try {
      const res = await window.opencodex.skills.fetchRegistry();
      if (res.error) {
        setRegistryError(res.error);
        setRegistryEntries([]);
      } else {
        setRegistryEntries(res.entries);
      }
    } catch (err) {
      setRegistryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegistryBusy(false);
    }
  }, []);

  const installFromRegistry = useCallback((entry: SkillRegistryEntry) => {
    setInstallConfirmEntry(entry);
  }, []);

  const confirmInstallFromRegistry = useCallback(async (entry: SkillRegistryEntry) => {
    setInstallConfirmEntry(null);
    setBusy(`__registry-${entry.name}`);
    setActionError(null);
    try {
      await window.opencodex.skills.importFromUrl({ url: entry.sourceUrl });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <div className="skills-panel">
      <div className="settings-block">
        <div className="settings-field-row">
          <input
            type="text"
            className="settings-input"
            value={newSkillName}
            onChange={(e) => setNewSkillName(e.target.value)}
            placeholder="my-skill-name"
          />
          <select
            className="settings-input settings-input-select"
            value={newSkillScope}
            onChange={(e) => setNewSkillScope(e.target.value as 'user' | 'project')}
          >
            <option value="user">User-global (~/.opencodex/skills)</option>
            <option value="project">Project (workspace .opencodex/skills)</option>
          </select>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void createSkill()}
            disabled={busy === '__new'}
          >
            {busy === '__new' ? 'Creating…' : 'New skill from template'}
          </button>
        </div>
        <div className="settings-field-row">
          <input
            type="text"
            className="settings-input"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://example.com/path/to/SKILL.md"
          />
          <button
            type="button"
            className="btn"
            onClick={() => void importSkill()}
            disabled={busy === '__import'}
          >
            {busy === '__import' ? 'Importing…' : 'Import from URL'}
          </button>
        </div>
        {importConfirmPending && (
          <div className="skills-confirm-row" role="alert">
            <span className="skills-confirm-message">
              Download and save <code>{importUrl.trim()}</code> to your user skills directory? Only
              import URLs you trust.
            </span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void confirmImportSkill()}
            >
              Confirm Import
            </button>
            <button type="button" className="btn" onClick={() => setImportConfirmPending(false)}>
              Cancel
            </button>
          </div>
        )}
        {actionError && (
          <p className="field-errors" role="alert">
            {actionError}
          </p>
        )}
        {loadError && (
          <p className="field-errors" role="alert">
            Failed to load skills: {loadError}
          </p>
        )}
      </div>

      {skills === null ? (
        <p className="audit-empty">Loading…</p>
      ) : skills.length === 0 ? (
        <div className="audit-empty-state" role="status">
          <p className="audit-empty">No skills installed yet.</p>
          <p className="audit-empty-sub">
            Skills are reusable markdown prompt templates. They appear in the chat composer as{' '}
            <code>/skill:&lt;name&gt;</code>, can declare an allowed-tools whitelist, and can
            auto-schedule themselves on a cron. Start with <strong>New skill from template</strong>{' '}
            above, or import one from the registry below.
          </p>
        </div>
      ) : (
        <ul className="audit-list">
          {skills.map((skill) => (
            <li key={skill.id} className="audit-row scheduled-task-row">
              <div className="scheduled-task-row-head">
                <div className="scheduled-task-row-info">
                  <div className="scheduled-task-name">
                    <code>/skill:{skill.name}</code>
                    <span
                      className={`pill${skill.scope === 'project' ? ' pill-local' : ' pill-neutral'}`}
                    >
                      {skill.scope}
                    </span>
                    {skill.disabled && <span className="pill pill-warn">disabled</span>}
                    {skill.frontmatter.cron && (
                      <span className="pill" title={`cron: ${skill.frontmatter.cron}`}>
                        cron
                      </span>
                    )}
                  </div>
                  <div className="scheduled-task-meta">
                    {skill.frontmatter.tools && skill.frontmatter.tools.length > 0 && (
                      <span title={skill.frontmatter.tools.join(', ')}>
                        tools: {skill.frontmatter.tools.length}
                      </span>
                    )}
                    {skill.frontmatter.triggers && skill.frontmatter.triggers.length > 0 && (
                      <span title={skill.frontmatter.triggers.join(', ')}>
                        triggers: {skill.frontmatter.triggers.length}
                      </span>
                    )}
                    {skill.frontmatter.arguments && skill.frontmatter.arguments.length > 0 && (
                      <span>args: {skill.frontmatter.arguments.length}</span>
                    )}
                    <span title={skill.sourcePath}>
                      <code>{skill.sourcePath}</code>
                    </span>
                  </div>
                  <p className="scheduled-task-description">{skill.description}</p>
                </div>
                <div className="scheduled-task-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void openInEditor(skill)}
                    disabled={busy === skill.id}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void toggleEnabled(skill)}
                    disabled={busy === skill.id}
                  >
                    {skill.disabled ? 'Enable' : 'Disable'}
                  </button>
                  <button type="button" className="btn" onClick={() => scheduleSkill(skill)}>
                    Schedule this skill
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="settings-divider" />

      <div className="settings-block skills-registry-section">
        <button
          type="button"
          className="btn skills-registry-toggle"
          onClick={() => setRegistryExpanded((v) => !v)}
          aria-expanded={registryExpanded}
        >
          {registryExpanded ? 'Hide community skills' : 'Browse community skills'}
        </button>
        {registryExpanded && (
          <div className="settings-block skills-registry-body">
            <p className="settings-block-hint">
              Point at any HTTPS URL that returns a JSON list of skills. There is no default
              registry — you opt in by configuring a URL you trust. Each entry has an Install button
              that prompts before downloading the SKILL.md.
            </p>
            <div className="settings-field-row">
              <input
                type="text"
                className="settings-input"
                value={registryUrl}
                onChange={(e) => setRegistryUrl(e.target.value)}
                placeholder="https://example.com/opencodex-skills.json"
              />
              <button
                type="button"
                className="btn"
                onClick={() => void saveRegistryUrl()}
                disabled={registryBusy}
              >
                {registryBusy ? 'Saving…' : 'Save URL'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void refreshRegistry()}
                disabled={registryBusy || !savedRegistryUrl}
              >
                {registryBusy ? 'Loading…' : 'Refresh'}
              </button>
              {registrySaved && (
                <span aria-live="polite" className="settings-saved-flash">
                  Saved
                </span>
              )}
            </div>
            {savedRegistryUrl && (
              <p className="settings-block-hint">
                Current: <code>{savedRegistryUrl}</code>
              </p>
            )}
            {registryError && (
              <p className="field-errors" role="alert">
                Registry error: {registryError}
              </p>
            )}
            {registryEntries === null ? (
              <p className="audit-empty">
                {savedRegistryUrl ? 'Click Refresh to load the registry.' : 'Save a URL to begin.'}
              </p>
            ) : registryEntries.length === 0 ? (
              <p className="audit-empty">No skills in the registry.</p>
            ) : (
              <ul className="audit-list">
                {registryEntries.map((entry) => (
                  <li key={entry.name} className="audit-row scheduled-task-row">
                    <div className="scheduled-task-row-head">
                      <div className="scheduled-task-row-info">
                        <div className="scheduled-task-name">
                          <code>/skill:{entry.name}</code>
                          {entry.version && (
                            <span className="pill" title={`version: ${entry.version}`}>
                              v{entry.version}
                            </span>
                          )}
                        </div>
                        <div className="scheduled-task-meta">
                          {entry.author && <span>by {entry.author}</span>}
                          <span title={entry.sourceUrl}>
                            <code>{entry.sourceUrl}</code>
                          </span>
                        </div>
                        <p className="scheduled-task-description">{entry.description}</p>
                      </div>
                      <div className="scheduled-task-actions">
                        {installConfirmEntry?.name === entry.name ? (
                          <>
                            <span className="skills-confirm-message">
                              Download into your user skills directory? Only install skills you
                              trust.
                            </span>
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => void confirmInstallFromRegistry(entry)}
                            >
                              Confirm Install
                            </button>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => setInstallConfirmEntry(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => installFromRegistry(entry)}
                            disabled={busy === `__registry-${entry.name}`}
                          >
                            {busy === `__registry-${entry.name}` ? 'Installing…' : 'Install'}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
