import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Transport } from './transport';
import type { StdioServerConfig } from './config';

type MessageHandler = (message: unknown) => void;
type CloseHandler = () => void;

export class StdioTransport implements Transport {
  readonly kind = 'stdio' as const;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private messageHandler: MessageHandler | null = null;
  private closeHandler: CloseHandler | null = null;
  private started = false;

  constructor(private readonly config: StdioServerConfig) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.child = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drainBuffer();
    });

    this.child.on('close', () => {
      this.started = false;
      this.closeHandler?.();
    });

    this.child.on('error', () => {
      this.started = false;
      this.closeHandler?.();
    });
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    try {
      this.child.kill('SIGTERM');
    } catch {
      // already gone
    }
    this.child = null;
    this.started = false;
  }

  async send(message: unknown): Promise<void> {
    if (!this.child) throw new Error('stdio transport is not started');
    const line = `${JSON.stringify(message)}\n`;
    await new Promise<void>((resolve, reject) => {
      this.child!.stdin.write(line, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }

  private drainBuffer(): void {
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        try {
          const parsed: unknown = JSON.parse(line);
          this.messageHandler?.(parsed);
        } catch {
          // malformed JSON line — skip
        }
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }
}
