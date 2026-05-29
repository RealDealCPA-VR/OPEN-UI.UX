import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Transport } from './transport';
import type { StdioServerConfig } from './config';

type MessageHandler = (message: unknown) => void;
type CloseHandler = () => void;

const STDERR_TAIL_BYTES = 16 * 1024;

const DEFAULT_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SHELL',
  'PWD',
  'SystemRoot',
  'SystemDrive',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'COMSPEC',
  'WINDIR',
  'PATHEXT',
];

function buildChildEnv(config: StdioServerConfig): NodeJS.ProcessEnv {
  const allow = new Set<string>(DEFAULT_ENV_ALLOWLIST.map((k) => k.toLowerCase()));
  for (const key of Object.keys(config.env ?? {})) {
    allow.add(key.toLowerCase());
  }
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (allow.has(key.toLowerCase())) result[key] = value;
  }
  for (const [key, value] of Object.entries(config.env ?? {})) {
    result[key] = value;
  }
  return result;
}

export class StdioTransport implements Transport {
  readonly kind = 'stdio' as const;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private readonly messageHandlers: MessageHandler[] = [];
  private readonly closeHandlers: CloseHandler[] = [];
  private started = false;
  private stderrTail = '';

  constructor(private readonly config: StdioServerConfig) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stderrTail = '';
    this.child = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env: buildChildEnv(this.config),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drainBuffer();
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    });

    this.child.on('close', () => {
      this.started = false;
      this.fireClose();
    });

    this.child.on('error', () => {
      this.started = false;
      this.fireClose();
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

  getStderrTail(): string {
    return this.stderrTail;
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
    this.messageHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  private fireClose(): void {
    for (const handler of this.closeHandlers) handler();
  }

  private dispatchMessage(parsed: unknown): void {
    for (const handler of this.messageHandlers) handler(parsed);
  }

  private drainBuffer(): void {
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        try {
          const parsed: unknown = JSON.parse(line);
          this.dispatchMessage(parsed);
        } catch {
          // malformed JSON line — skip
        }
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }
}
