import { useCallback, useEffect, useState } from 'react';
import type { PairSuggestion } from '../../shared/pair';
import './suggestions-pane.css';

interface SuggestionsPaneProps {
  conversationId: string | null;
}

export function SuggestionsPane({ conversationId }: SuggestionsPaneProps): JSX.Element {
  const [suggestions, setSuggestions] = useState<PairSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!conversationId) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await window.opencodex.pair.getActiveSuggestions({ conversationId });
      setSuggestions(res.suggestions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      if (cancelled) return;
      await refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!conversationId) return undefined;
    const off = window.opencodex.pair.onSuggestion((evt) => {
      if (evt.suggestion.conversationId !== conversationId) return;
      setSuggestions((prev) => {
        if (prev.some((s) => s.id === evt.suggestion.id)) return prev;
        return [evt.suggestion, ...prev];
      });
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [conversationId]);

  const handleDismiss = useCallback(async (id: string): Promise<void> => {
    try {
      await window.opencodex.pair.dismissSuggestion({ suggestionId: id });
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleApply = useCallback(async (id: string): Promise<void> => {
    try {
      await window.opencodex.pair.applyAsContext({ suggestionId: id });
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return (
    <div className="pair-suggestions-pane">
      <div className="pair-suggestions-head">
        <span className="pair-suggestions-title">Suggestions</span>
        <span className="pair-suggestions-count" aria-label={`${suggestions.length} pending`}>
          {suggestions.length}
        </span>
      </div>
      {error ? <div className="pair-suggestions-error">{error}</div> : null}
      {suggestions.length === 0 ? (
        <div className="pair-suggestions-empty">
          No file-change suggestions yet. Edit a file referenced in this conversation and a card
          will appear here. Suggestions never auto-apply.
        </div>
      ) : (
        <ul className="pair-suggestions-list">
          {suggestions.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              onDismiss={() => void handleDismiss(s.id)}
              onApply={() => void handleApply(s.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface SuggestionCardProps {
  suggestion: PairSuggestion;
  onDismiss: () => void;
  onApply: () => void;
}

function SuggestionCard({ suggestion, onDismiss, onApply }: SuggestionCardProps): JSX.Element {
  const verb =
    suggestion.changeKind === 'edit'
      ? 'edited'
      : suggestion.changeKind === 'create'
        ? 'created'
        : 'deleted';
  return (
    <li className="pair-suggestion-card">
      <div className="pair-suggestion-body">
        <div className="pair-suggestion-verb">{verb}</div>
        <div className="pair-suggestion-path" title={suggestion.filePath}>
          {suggestion.filePath}
        </div>
        <div className="pair-suggestion-time">
          {new Date(suggestion.createdAt).toLocaleTimeString()}
        </div>
      </div>
      <div className="pair-suggestion-actions">
        <button type="button" className="pair-suggestion-apply" onClick={onApply}>
          Apply as context
        </button>
        <button
          type="button"
          className="pair-suggestion-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss suggestion"
        >
          ×
        </button>
      </div>
    </li>
  );
}

export default SuggestionsPane;
