export type TransportKind = 'stdio' | 'sse' | 'http';

export interface Transport {
  readonly kind: TransportKind;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: unknown): Promise<void>;
  onMessage(handler: (message: unknown) => void): void;
  onClose(handler: () => void): void;
}
