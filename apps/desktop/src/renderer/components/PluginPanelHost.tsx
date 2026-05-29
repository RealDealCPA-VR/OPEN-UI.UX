/**
 * Sandboxed plugin panel host.
 *
 * Renders a plugin-contributed `panel.html` inside an `<iframe sandbox="allow-scripts">`.
 * Because the iframe is loaded without `allow-same-origin`, its window has a unique
 * opaque origin and `event.origin === "null"` for messages it posts. We therefore
 * authenticate inbound messages by reference identity — `event.source === iframe.contentWindow`
 * — and never by origin string matching.
 *
 * postMessage protocol (host <-> panel):
 *
 *   Panel -> Host:
 *     { kind: 'log',          level: 'info' | 'warn' | 'error', message: string }
 *     { kind: 'request-host', requestId: string, op: 'ping' }
 *
 *   Host -> Panel (in response to request-host):
 *     { kind: 'host-response', requestId: string, ok: true,  data: unknown }
 *     { kind: 'host-response', requestId: string, ok: false, error: string }
 *
 * Anything that doesn't parse against `PanelMessageSchema` is dropped silently
 * (after a console.warn) — this is the trust boundary.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import type { PluginPanelDescriptor } from '../../shared/plugins';
import { logger } from '../logger';

export const PanelLogMessageSchema = z.object({
  kind: z.literal('log'),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string().max(2000),
});

export const PanelRequestHostMessageSchema = z.object({
  kind: z.literal('request-host'),
  requestId: z.string().min(1).max(128),
  op: z.literal('ping'),
});

export const PanelMessageSchema = z.discriminatedUnion('kind', [
  PanelLogMessageSchema,
  PanelRequestHostMessageSchema,
]);

export type PanelMessage = z.infer<typeof PanelMessageSchema>;

export const HostResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    kind: z.literal('host-response'),
    requestId: z.string(),
    ok: z.literal(true),
    data: z.unknown(),
  }),
  z.object({
    kind: z.literal('host-response'),
    requestId: z.string(),
    ok: z.literal(false),
    error: z.string(),
  }),
]);

export type HostResponse = z.infer<typeof HostResponseSchema>;

export interface PanelMessageContext {
  pluginId: string;
  panelId: string;
  log: (level: 'info' | 'warn' | 'error', line: string) => void;
}

export function handlePanelMessage(raw: unknown, ctx: PanelMessageContext): HostResponse | null {
  const parsed = PanelMessageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const msg = parsed.data;
  if (msg.kind === 'log') {
    ctx.log(msg.level, `[plugin ${ctx.pluginId}/${ctx.panelId}] ${msg.message}`);
    return null;
  }
  // request-host
  if (msg.op === 'ping') {
    return {
      kind: 'host-response',
      requestId: msg.requestId,
      ok: true,
      data: { pong: true, pluginId: ctx.pluginId, panelId: ctx.panelId },
    };
  }
  return {
    kind: 'host-response',
    requestId: msg.requestId,
    ok: false,
    error: 'unsupported op',
  };
}

export class PluginPanelPathTraversalError extends Error {
  constructor(path: string) {
    super(`Plugin panel htmlPath rejected: traversal segment in ${path}`);
    this.name = 'PluginPanelPathTraversalError';
  }
}

export function toFileUrl(p: string): string {
  if (typeof p !== 'string' || p.length === 0) {
    throw new PluginPanelPathTraversalError(String(p));
  }
  const normalized = p.replace(/\\/g, '/');
  const segments = normalized.split('/');
  for (const seg of segments) {
    if (seg === '..') throw new PluginPanelPathTraversalError(p);
  }
  if (/%2e%2e/i.test(normalized) || /%2f%2e%2e/i.test(normalized)) {
    throw new PluginPanelPathTraversalError(p);
  }
  const isWindowsDrive = /^[a-zA-Z]:\//.test(normalized);
  if (!isWindowsDrive && /^[a-z][a-z0-9+.-]*:/i.test(normalized) && !/^file:/i.test(normalized)) {
    throw new PluginPanelPathTraversalError(p);
  }
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${prefixed}`;
}

export interface PluginPanelHostProps {
  pluginId: string;
  panelId: string;
  htmlPath: string;
}

export function PluginPanelHostInner({
  pluginId,
  panelId,
  htmlPath,
}: PluginPanelHostProps): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const src = useMemo(() => toFileUrl(htmlPath), [htmlPath]);

  useEffect(() => {
    function onMessage(event: MessageEvent): void {
      const iframe = iframeRef.current;
      if (!iframe) return;
      if (event.source !== iframe.contentWindow) return;
      const response = handlePanelMessage(event.data, {
        pluginId,
        panelId,
        log: (level, line) => {
          if (level === 'error') logger.error(line);
          else if (level === 'warn') logger.warn(line);
          else logger.info(line);
        },
      });
      if (response && iframe.contentWindow) {
        iframe.contentWindow.postMessage(response, '*');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pluginId, panelId]);

  return (
    <section className="view plugin-panel-host">
      <header className="plugin-panel-host__header">
        <h1>
          Plugin panel: {pluginId} / {panelId}
        </h1>
      </header>
      <iframe
        ref={iframeRef}
        title={`plugin-panel-${pluginId}-${panelId}`}
        src={src}
        sandbox="allow-scripts"
        className="plugin-panel-host__frame"
        style={{ width: '100%', height: '100%', border: 0 }}
      />
    </section>
  );
}

export function PluginPanelHost(): JSX.Element {
  const params = useParams<{ pluginId: string; panelId: string }>();
  const [panels, setPanels] = useState<PluginPanelDescriptor[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.opencodex.plugins
      .listPanels()
      .then((res) => {
        if (!cancelled) setPanels(res.panels);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <section className="view">
        <h1>Plugin panel</h1>
        <p>Failed to load panel list: {error}</p>
      </section>
    );
  }
  if (!panels) {
    return (
      <section className="view">
        <h1>Plugin panel</h1>
        <p>Loading...</p>
      </section>
    );
  }
  const descriptor = panels.find((p) => p.pluginId === params.pluginId && p.id === params.panelId);
  if (!descriptor) {
    return (
      <section className="view">
        <h1>Plugin panel</h1>
        <p>
          No panel found for <code>{params.pluginId}</code> / <code>{params.panelId}</code>. The
          plugin may be disabled or missing required permissions.
        </p>
      </section>
    );
  }
  return (
    <PluginPanelHostInner
      pluginId={descriptor.pluginId}
      panelId={descriptor.id}
      htmlPath={descriptor.htmlPath}
    />
  );
}
