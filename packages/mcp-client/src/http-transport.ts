import type { Transport } from './transport';
import type { HttpServerConfig } from './config';

type MessageHandler = (message: unknown) => void;
type CloseHandler = () => void;

export class HttpTransport implements Transport {
  readonly kind = 'http' as const;
  private messageHandler: MessageHandler | null = null;
  private closeHandler: CloseHandler | null = null;
  private sessionId: string | null = null;
  private started = false;
  private abort: AbortController | null = null;

  constructor(private readonly config: HttpServerConfig) {}

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
    this.closeHandler?.();
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
    if (newSession) this.sessionId = newSession;

    if (response.status === 202) return; // notification accepted

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const parsed: unknown = await response.json();
      this.messageHandler?.(parsed);
      return;
    }
    if (contentType.includes('text/event-stream') && response.body) {
      void this.consumeStream(response.body);
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
      this.messageHandler?.(parsed);
    } catch {
      // ignore malformed
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }
}
