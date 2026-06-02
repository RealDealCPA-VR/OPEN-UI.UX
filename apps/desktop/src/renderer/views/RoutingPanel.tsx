import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ROUTING_PRESETS,
  type RoutingPolicy,
  type RoutingRule,
  type RoutingRuleWhen,
  type RoutingState,
} from '../../shared/routing';

const RULE_LABELS: Record<RoutingRuleWhen, string> = {
  tool_call: 'Tool calls',
  reasoning: 'Reasoning / long-form',
  embedding: 'Embeddings',
  sensitive_path: 'Sensitive paths',
};

const RULE_HINTS: Record<RoutingRuleWhen, string> = {
  tool_call: 'Cheap, fast models do well on tool-heavy turns. Pick a smaller model here.',
  reasoning: 'For deep analysis or refactors, route to a frontier-tier model.',
  embedding: 'Embeddings are cheap on a small or local model — no need for a frontier tier.',
  sensitive_path: 'For paths matched as sensitive (secrets, prod), keep the request local.',
};

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRoutingApiAvailable(): boolean {
  // The Routing IPC namespace is wired by the consolidator. Guard so this panel
  // can render in renderer-only test harnesses without throwing.
  const w = window as unknown as { opencodex?: { routing?: unknown } };
  return Boolean(w.opencodex?.routing);
}

export function RoutingPanel(): JSX.Element {
  const [state, setState] = useState<RoutingState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    if (!isRoutingApiAvailable()) {
      setLoadError('Routing IPC is not wired in this build.');
      return;
    }
    try {
      const w = window as unknown as {
        opencodex: { routing: { getState: () => Promise<RoutingState> } };
      };
      const s = await w.opencodex.routing.getState();
      setState(s);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      if (cancelled) return;
      await loadState();
    });
    if (!isRoutingApiAvailable()) {
      return () => {
        cancelled = true;
      };
    }
    const w = window as unknown as {
      opencodex: {
        routing: { onChanged?: (l: (e: { state: RoutingState }) => void) => () => void };
      };
    };
    const off = w.opencodex.routing.onChanged?.((e) => setState(e.state));
    return () => {
      cancelled = true;
      off?.();
    };
  }, [loadState]);

  const activePolicy = useMemo<RoutingPolicy | null>(() => {
    if (!state || !state.activePolicyId) return null;
    return state.policies.find((p) => p.id === state.activePolicyId) ?? null;
  }, [state]);

  const installPreset = useCallback(async (presetId: string) => {
    const preset = ROUTING_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setPending(`preset:${presetId}`);
    setActionError(null);
    try {
      const w = window as unknown as {
        opencodex: {
          routing: {
            createPolicy: (req: { policy: RoutingPolicy }) => Promise<RoutingState>;
            setActive: (req: { id: string | null }) => Promise<RoutingState>;
          };
        };
      };
      const id = `${preset.id}-${Date.now().toString(36)}`;
      const next = await w.opencodex.routing.createPolicy({
        policy: { id, name: preset.name, rules: [...preset.rules] },
      });
      await w.opencodex.routing.setActive({ id });
      setState(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }, []);

  const createBlank = useCallback(async () => {
    setPending('create-blank');
    setActionError(null);
    try {
      const w = window as unknown as {
        opencodex: {
          routing: { createPolicy: (req: { policy: RoutingPolicy }) => Promise<RoutingState> };
        };
      };
      const id = `custom-${Date.now().toString(36)}`;
      const next = await w.opencodex.routing.createPolicy({
        policy: { id, name: 'Custom policy', rules: [] },
      });
      setState(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }, []);

  const setActive = useCallback(async (id: string | null) => {
    setPending(`activate:${id ?? 'null'}`);
    setActionError(null);
    try {
      const w = window as unknown as {
        opencodex: {
          routing: { setActive: (req: { id: string | null }) => Promise<RoutingState> };
        };
      };
      const next = await w.opencodex.routing.setActive({ id });
      setState(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }, []);

  const deletePolicy = useCallback(async (id: string) => {
    setPending(`delete:${id}`);
    setActionError(null);
    try {
      const w = window as unknown as {
        opencodex: {
          routing: { deletePolicy: (req: { id: string }) => Promise<RoutingState> };
        };
      };
      const next = await w.opencodex.routing.deletePolicy({ id });
      setState(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }, []);

  const updateRule = useCallback(
    async (policyId: string, rule: RoutingRule) => {
      if (!state) return;
      const target = state.policies.find((p) => p.id === policyId);
      if (!target) return;
      const otherRules = target.rules.filter((r) => r.id !== rule.id);
      const nextRules = [...otherRules, rule];
      setPending(`rule:${policyId}:${rule.id}`);
      setActionError(null);
      try {
        const w = window as unknown as {
          opencodex: {
            routing: {
              updatePolicy: (req: {
                id: string;
                patch: Partial<RoutingPolicy>;
              }) => Promise<RoutingState>;
            };
          };
        };
        const next = await w.opencodex.routing.updatePolicy({
          id: policyId,
          patch: { rules: nextRules },
        });
        setState(next);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(null);
      }
    },
    [state],
  );

  const deleteRule = useCallback(
    async (policyId: string, ruleId: string) => {
      if (!state) return;
      const target = state.policies.find((p) => p.id === policyId);
      if (!target) return;
      setPending(`rule-delete:${policyId}:${ruleId}`);
      setActionError(null);
      try {
        const w = window as unknown as {
          opencodex: {
            routing: {
              updatePolicy: (req: {
                id: string;
                patch: Partial<RoutingPolicy>;
              }) => Promise<RoutingState>;
            };
          };
        };
        const next = await w.opencodex.routing.updatePolicy({
          id: policyId,
          patch: { rules: target.rules.filter((r) => r.id !== ruleId) },
        });
        setState(next);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(null);
      }
    },
    [state],
  );

  if (loadError) {
    return (
      <div className="routing-panel">
        <p className="routing-error" role="alert">
          Failed to load routing: {loadError}
        </p>
      </div>
    );
  }
  if (!state) {
    return <p className="routing-loading">Loading routing…</p>;
  }

  return (
    <div className="routing-panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section data-settings-anchor="routing-presets">
        <h3 style={{ marginBottom: 6 }}>Presets</h3>
        <p className="routing-hint" style={{ color: 'var(--text-secondary)', marginBottom: 10 }}>
          Install a starter policy in one click. You can tweak its rules afterwards.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 10,
          }}
        >
          {ROUTING_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="btn"
              disabled={pending === `preset:${preset.id}`}
              onClick={() => void installPreset(preset.id)}
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
              }}
            >
              <div style={{ fontWeight: 600 }}>{preset.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {preset.description}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section data-settings-anchor="routing-policies">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 6,
          }}
        >
          <h3 style={{ margin: 0 }}>Policies</h3>
          <button
            type="button"
            className="btn"
            disabled={pending === 'create-blank'}
            onClick={() => void createBlank()}
          >
            New blank policy
          </button>
        </div>
        {actionError && (
          <p className="routing-action-error" role="alert" style={{ color: 'var(--danger)' }}>
            {actionError}
          </p>
        )}
        {state.policies.length === 0 && (
          <p style={{ color: 'var(--text-muted)' }}>
            No policies yet. Install a preset above or create a blank policy.
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {state.policies.map((p) => {
            const isActive = activePolicy?.id === p.id;
            return (
              <div
                key={p.id}
                style={{
                  background: 'var(--bg-panel)',
                  border: `1px solid ${isActive ? 'var(--accent-border)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)',
                  padding: 12,
                }}
                data-settings-anchor={`routing-policy-${p.id}`}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>{p.name}</strong>
                    {isActive && <span className="pill pill-local">active</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {!isActive && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void setActive(p.id)}
                        disabled={pending === `activate:${p.id}`}
                      >
                        Activate
                      </button>
                    )}
                    {isActive && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void setActive(null)}
                        disabled={pending === 'activate:null'}
                      >
                        Deactivate
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => void deletePolicy(p.id)}
                      disabled={pending === `delete:${p.id}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <RuleEditor
                  policy={p}
                  onUpdate={(rule) => void updateRule(p.id, rule)}
                  onDelete={(ruleId) => void deleteRule(p.id, ruleId)}
                  pendingKey={pending}
                />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function RuleEditor(props: {
  policy: RoutingPolicy;
  onUpdate: (rule: RoutingRule) => void;
  onDelete: (ruleId: string) => void;
  pendingKey: string | null;
}): JSX.Element {
  const { policy, onUpdate, onDelete, pendingKey } = props;
  const allTraits: ReadonlyArray<RoutingRuleWhen> = useMemo(
    () => ['tool_call', 'reasoning', 'embedding', 'sensitive_path'],
    [],
  );
  const usedTraits = new Set(policy.rules.map((r) => r.when));
  const unused = allTraits.filter((t) => !usedTraits.has(t));

  const addRule = (trait: RoutingRuleWhen): void => {
    onUpdate({
      id: newId(),
      when: trait,
      use: { providerId: '', modelId: '' },
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {policy.rules.map((rule) => (
        <div
          key={rule.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '160px 1fr 1fr auto',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{RULE_LABELS[rule.when]}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{RULE_HINTS[rule.when]}</div>
          </div>
          <input
            className="settings-input"
            placeholder="providerId"
            aria-label={`${RULE_LABELS[rule.when]} provider ID`}
            value={rule.use.providerId}
            onChange={(e) =>
              onUpdate({ ...rule, use: { ...rule.use, providerId: e.target.value } })
            }
            disabled={pendingKey === `rule:${policy.id}:${rule.id}`}
          />
          <input
            className="settings-input"
            placeholder="modelId"
            aria-label={`${RULE_LABELS[rule.when]} model ID`}
            value={rule.use.modelId}
            onChange={(e) => onUpdate({ ...rule, use: { ...rule.use, modelId: e.target.value } })}
            disabled={pendingKey === `rule:${policy.id}:${rule.id}`}
          />
          <button
            type="button"
            className="btn"
            onClick={() => onDelete(rule.id)}
            disabled={pendingKey === `rule-delete:${policy.id}:${rule.id}`}
          >
            Remove
          </button>
        </div>
      ))}
      {unused.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {unused.map((t) => (
            <button key={t} type="button" className="btn" onClick={() => addRule(t)}>
              + Add {RULE_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
