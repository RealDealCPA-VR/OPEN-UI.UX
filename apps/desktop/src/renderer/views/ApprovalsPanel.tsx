import type { PermissionTier } from '@opencodex/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApprovalPolicies, ApprovalPolicy } from '../../shared/approvals';
import type { ToolListItem } from '../../shared/tools';

const TIER_ORDER: readonly PermissionTier[] = ['read', 'write', 'execute', 'network'];

const TIER_LABELS: Record<PermissionTier, string> = {
  read: 'Read',
  write: 'Write',
  execute: 'Execute',
  network: 'Network',
};

const TIER_DESCRIPTIONS: Record<PermissionTier, string> = {
  read: 'Inspect files, list directories, search code.',
  write: 'Create, edit, or overwrite files in the workspace.',
  execute: 'Run shell commands.',
  network: 'Make outbound HTTP requests.',
};

const POLICY_LABELS: Record<ApprovalPolicy, string> = {
  auto: 'Auto-allow',
  prompt: 'Prompt',
  deny: 'Always deny',
};

export function ApprovalsPanel(): JSX.Element {
  const [policies, setPolicies] = useState<ApprovalPolicies | null>(null);
  const [tools, setTools] = useState<ToolListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, t] = await Promise.all([
          window.opencodex.approvals.getPolicies(),
          window.opencodex.tools.list(),
        ]);
        if (cancelled) return;
        setPolicies(p);
        setTools(t);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setTierPolicy = useCallback(async (tier: PermissionTier, policy: ApprovalPolicy) => {
    const key = `tier:${tier}`;
    setPendingKey(key);
    setSaveError(null);
    try {
      const next = await window.opencodex.approvals.setPolicy({
        scope: 'tier',
        key: tier,
        policy,
      });
      setPolicies(next);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey((k) => (k === key ? null : k));
    }
  }, []);

  const setToolOverride = useCallback(async (toolName: string, policy: ApprovalPolicy | null) => {
    const key = `tool:${toolName}`;
    setPendingKey(key);
    setSaveError(null);
    try {
      const next = await window.opencodex.approvals.setPolicy({
        scope: 'tool',
        key: toolName,
        policy,
      });
      setPolicies(next);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey((k) => (k === key ? null : k));
    }
  }, []);

  const toolsByTier = useMemo(() => {
    const out: Record<PermissionTier, ToolListItem[]> = {
      read: [],
      write: [],
      execute: [],
      network: [],
    };
    for (const t of tools ?? []) out[t.permissionTier].push(t);
    for (const tier of TIER_ORDER) out[tier].sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [tools]);

  if (loadError) {
    return (
      <div className="field-errors approvals-load-error" role="alert">
        <div>Failed to load approval policies: {loadError}</div>
        <button type="button" className="btn btn-danger" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }
  if (!policies || !tools) {
    return (
      <div className="approvals-loading" aria-busy="true">
        <SkeletonRows count={4} />
      </div>
    );
  }

  return (
    <div className="approvals-panel">
      <div className="settings-block">
        <h3 className="settings-subhead">Tier defaults</h3>
        <p className="settings-block-hint">
          Applies to every tool in that tier unless overridden below.
        </p>
        <ul className="approvals-list">
          {TIER_ORDER.map((tier) => (
            <li key={tier} className="approvals-row">
              <div className="approvals-row-main">
                <span className={`pill tool-tier tool-tier-${tier}`}>{TIER_LABELS[tier]}</span>
                <span className="approvals-row-desc">{TIER_DESCRIPTIONS[tier]}</span>
              </div>
              <select
                className="settings-input settings-input-select"
                value={policies.tierDefaults[tier]}
                disabled={pendingKey === `tier:${tier}`}
                onChange={(e) => void setTierPolicy(tier, e.target.value as ApprovalPolicy)}
              >
                <option value="auto">{POLICY_LABELS.auto}</option>
                <option value="prompt">{POLICY_LABELS.prompt}</option>
                <option value="deny">{POLICY_LABELS.deny}</option>
              </select>
            </li>
          ))}
        </ul>
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <h3 className="settings-subhead">Per-tool overrides</h3>
        <p className="settings-block-hint">
          Override a single tool. <em>Inherit</em> uses the tier default above.
        </p>
        {TIER_ORDER.map((tier) =>
          toolsByTier[tier].length === 0 ? null : (
            <div key={tier} className="approvals-tool-group">
              <div className="approvals-tool-group-head">
                <span className={`pill tool-tier tool-tier-${tier}`}>{TIER_LABELS[tier]}</span>
              </div>
              <ul className="approvals-list">
                {toolsByTier[tier].map((tool) => {
                  const override = policies.toolOverrides[tool.name] ?? null;
                  const tierDefault = policies.tierDefaults[tier];
                  const inheritLabel = `Inherit (${POLICY_LABELS[tierDefault]})`;
                  const value = override ?? 'inherit';
                  return (
                    <li
                      key={tool.name}
                      className="approvals-row"
                      data-settings-anchor={`tool:${tool.name}`}
                    >
                      <div className="approvals-row-main">
                        <code className="approvals-tool-name" title={tool.description}>
                          {tool.name}
                        </code>
                        <span className="approvals-row-desc" title={tool.description}>
                          {tool.description}
                        </span>
                        <span className="approvals-row-tier-hint">
                          Default for <code>{tier}</code> tier: {POLICY_LABELS[tierDefault]}
                        </span>
                      </div>
                      <select
                        className="settings-input settings-input-select"
                        value={value}
                        disabled={pendingKey === `tool:${tool.name}`}
                        onChange={(e) => {
                          const v = e.target.value;
                          void setToolOverride(
                            tool.name,
                            v === 'inherit' ? null : (v as ApprovalPolicy),
                          );
                        }}
                      >
                        <option value="inherit">{inheritLabel}</option>
                        <option value="auto">{POLICY_LABELS.auto}</option>
                        <option value="prompt">{POLICY_LABELS.prompt}</option>
                        <option value="deny">{POLICY_LABELS.deny}</option>
                      </select>
                    </li>
                  );
                })}
              </ul>
            </div>
          ),
        )}
      </div>

      {saveError && (
        <p className="field-errors" role="alert">
          Failed to save: {saveError}
        </p>
      )}
    </div>
  );
}

function SkeletonRows({ count }: { count: number }): JSX.Element {
  return (
    <ul className="approvals-skeleton-list">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          aria-hidden="true"
          style={{
            height: 36,
            borderRadius: 'var(--radius-sm)',
            background:
              'linear-gradient(90deg, var(--bg-elevated) 0%, var(--border) 50%, var(--bg-elevated) 100%)',
            backgroundSize: '200% 100%',
            animation: 'settings-skeleton-pulse 1.4s ease-in-out infinite',
          }}
        />
      ))}
    </ul>
  );
}
