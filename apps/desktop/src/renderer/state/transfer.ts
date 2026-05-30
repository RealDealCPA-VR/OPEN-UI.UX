import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { TransferContext } from '../../shared/transfer-context';

type Listener = () => void;

let current: TransferContext | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): TransferContext | null {
  return current;
}

export function pushTransfer(ctx: TransferContext): void {
  current = ctx;
  emit();
}

export function consumeTransfer(): TransferContext | null {
  const prev = current;
  current = null;
  if (prev !== null) emit();
  return prev;
}

export function peekTransfer(): TransferContext | null {
  return current;
}

/**
 * Subscribe to transfer pushes. The handler is invoked from a subscription
 * callback (not a React effect body), so setState calls inside it do not trip
 * the `react-hooks/set-state-in-effect` rule.
 *
 * If a transfer is already pending when this is called, the handler is invoked
 * asynchronously (microtask) so callers don't have to special-case "is there
 * one pending right now".
 */
export function onTransferPushed(handler: (ctx: TransferContext) => void): () => void {
  const wrapped = (): void => {
    if (current) handler(current);
  };
  const unsub = subscribe(wrapped);
  if (current) queueMicrotask(wrapped);
  return unsub;
}

export function useTransferPending(): TransferContext | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe to transfer events of a particular kind. The handler is called
 * whenever a matching transfer is pushed; the consumer is expected to call
 * `consumeTransfer()` once it has processed the payload.
 *
 * The handler is captured in a ref so callers can pass an inline arrow without
 * causing the effect to re-fire on every render.
 */
export function useTransferConsumer<K extends TransferContext['kind']>(
  kind: K,
  handler: (ctx: Extract<TransferContext, { kind: K }>) => void,
): void {
  const pending = useTransferPending();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(() => {
    if (!pending) return;
    if (pending.kind !== kind) return;
    handlerRef.current(pending as Extract<TransferContext, { kind: K }>);
  }, [pending, kind]);
}

/** Test-only: reset the singleton. */
export function __resetTransferForTests(): void {
  current = null;
  listeners.clear();
}
