import type { Transport } from './transport';
import type { HttpServerConfig } from './config';
import { assertHostAllowed } from './host-guard';

type MessageHandler = (message: unknown) => void;
type CloseHandler = () => void;

export class HttpTransport implements Transport {
  readonly kind = 'http' as const;
  private readonly messageHandlers: MessageHandler[] = [];
  private readonly closeHandlers: CloseHandler[] = [];
  private sessionId: string | null = null;
  private started = false;
  private abort: AbortController | null = null;
  private listenChannelStarted = false;

  constructor(private readonly config: HttpServerConfig) {
    assertHostAllowed(config.url, { allowlist: config.hostAllowlist });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.abort = new AbortController();
  }

  async stop(): Promise<void> {
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
    this.started = false;
    this.fireClose();
  }

  async send(message: unknown): Promise<void> {
    if (!this.started) throw new Error('HTTP transport is not started');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.config.headers ?? {}),
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

    const response = await fetch(this.config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal: this.abort?.signal,
    });

    if (!response.ok) throw new Error(`HTTP transport ${response.status}`);

    const newSession = response.headers.get('mcp-session-id');
    if (newSession) {
      this.sessionId = newSession;
      this.maybeStartListenChannel();
    }

    if (response.status === 202) return;

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const parsed: unknown = await response.json();
      this.dispatchMessage(parsed);
      return;
    }
    if (contentType.includes('text/event-stream') && response.body) {
      void this.consumeStream(response.body);
    }
  }

  private maybeStartListenChannel(): void {
    if (this.listenChannelStarted) return;
    this.listenChannelStarted = true;
    void this.openListenChannel();
  }

  private async openListenChannel(): Promise<void> {
    if (!this.abort) return;
    try {
      const headers: Record<string, string> = {
        accept: 'text/event-stream',
        ...(this.config.headers ?? {}),
      };
      if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

      const response = await fetch(this.config.url, {
        method: 'GET',
        headers,
        signal: this.abort.signal,
      });

      if (!response.ok || !response.body) return;
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/event-stream')) return;
      await this.consumeStream(response.body);
    } catch {
      // listen channel ended; not fatal
    } finally {
      this.listenChannelStarted = false;
    }
  }

  private async consumeStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let dataLines: string[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (dataLines.length > 0) this.dispatch(dataLines.join('\n'));
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const rawLine = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
          if (line === '') {
            if (dataLines.length > 0) {
              this.dispatch(dataLines.join('\n'));
              dataLines = [];
            }
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
          newline = buffer.indexOf('\n');
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private dispatch(data: string): void {
    try {
      const parsed: unknown = JSON.parse(data);
      this.dispatchMessage(parsed);
    } catch {
      // ignore malformed
    }
  }

  private dispatchMessage(parsed: unknown): void {
    for (const handler of this.messageHandlers) handler(parsed);
  }

  private fireClose(): void {
    for (const handler of this.closeHandlers) handler();
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }
}
