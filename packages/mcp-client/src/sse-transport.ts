import type { Transport } from './transport';
import type { SseServerConfig } from './config';

type MessageHandler = (message: unknown) => void;
type CloseHandler = () => void;

interface EventStreamEvent {
  event: string;
  data: string;
}

async function* parseEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<EventStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';
  let dataLines: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (dataLines.length > 0) {
          yield { event: currentEvent, data: dataLines.join('\n') };
        }
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
            yield { event: currentEvent, data: dataLines.join('\n') };
            dataLines = [];
            currentEvent = 'message';
          }
        } else if (line.startsWith(':')) {
          // SSE comment — ignore
        } else {
          const colon = line.indexOf(':');
          const field = colon === -1 ? line : line.slice(0, colon);
          const valueRaw = colon === -1 ? '' : line.slice(colon + 1);
          const value = valueRaw.startsWith(' ') ? valueRaw.slice(1) : valueRaw;
          if (field === 'event') currentEvent = value;
          else if (field === 'data') dataLines.push(value);
        }
        newline = buffer.indexOf('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class SseTransport implements Transport {
  readonly kind = 'sse' as const;
  private abort: AbortController | null = null;
  private postUrl: string | null = null;
  private messageHandler: MessageHandler | null = null;
  private closeHandler: CloseHandler | null = null;
  private started = false;

  constructor(private readonly config: SseServerConfig) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.abort = new AbortController();

    const headers: Record<string, string> = {
      accept: 'text/event-stream',
      ...(this.config.headers ?? {}),
    };

    const response = await fetch(this.config.url, {
      headers,
      signal: this.abort.signal,
    });

    if (!response.ok || !response.body) {
      this.started = false;
      throw new Error(`SSE transport HTTP ${response.status}`);
    }

    void this.consume(response.body);
  }

  private async consume(body: ReadableStream<Uint8Array>): Promise<void> {
    try {
      for await (const evt of parseEventStream(body)) {
        if (evt.event === 'endpoint') {
          this.postUrl = new URL(evt.data, this.config.url).toString();
        } else if (evt.event === 'message') {
          try {
            const parsed: unknown = JSON.parse(evt.data);
            this.messageHandler?.(parsed);
          } catch {
            // ignore malformed payloads
          }
        }
      }
    } catch {
      // stream closed
    } finally {
      this.started = false;
      this.closeHandler?.();
    }
  }

  async stop(): Promise<void> {
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
    this.started = false;
  }

  async send(message: unknown): Promise<void> {
    if (!this.postUrl) throw new Error('SSE transport has no endpoint URL yet');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(this.config.headers ?? {}),
    };
    const response = await fetch(this.postUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      throw new Error(`SSE POST HTTP ${response.status}`);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }
}
