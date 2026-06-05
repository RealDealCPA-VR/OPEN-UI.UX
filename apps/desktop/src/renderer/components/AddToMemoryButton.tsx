import { useCallback, useState } from 'react';

export interface AddToMemoryButtonProps {
  content: string;
  defaultHeading?: string;
}

export function AddToMemoryButton(props: AddToMemoryButtonProps): JSX.Element | null {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const text = props.content.trim();
  const onClick = useCallback(async () => {
    if (text.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const heading =
        (props.defaultHeading?.trim().length ?? 0)
          ? props.defaultHeading!.trim()
          : new Date().toISOString().slice(0, 10);
      const api = (
        window as unknown as {
          opencodex?: { memory?: { appendLocal?: (h: string, c: string) => Promise<unknown> } };
        }
      ).opencodex;
      const append = api?.memory?.appendLocal;
      if (!append) {
        throw new Error('Local memory backend is not available. Enable it in Settings → Memory.');
      }
      await append(heading, text);
      setDone('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDone('error');
    } finally {
      setPending(false);
    }
  }, [props.defaultHeading, text]);

  if (text.length === 0) return null;

  return (
    <button
      type="button"
      className={`btn btn-ghost btn-tiny${done === 'error' ? ' btn-danger' : ''}`}
      onClick={() => void onClick()}
      disabled={pending}
      title={error ?? 'Append this reply to .opencodex/memory.md'}
      data-testid="add-to-memory-button"
    >
      {done === 'saved'
        ? 'Saved to memory'
        : done === 'error'
          ? 'Save failed'
          : pending
            ? 'Saving…'
            : '+ Add to project memory'}
    </button>
  );
}
