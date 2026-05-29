/**
 * LSP-style bridge stub for the pair-programming mode.
 *
 * follow-up: real implementation will speak Language Server Protocol over stdio
 * to an external server (e.g. typescript-language-server) and surface
 * diagnostics + hover + go-to-def to the pair suggestions pane.
 */

export type LspDiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface LspDiagnostic {
  filePath: string;
  line: number;
  column: number;
  severity: LspDiagnosticSeverity;
  message: string;
  source?: string;
}

export interface LspBridge {
  start(workspaceRoot: string): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  /** Subscribe to diagnostic events; returns an unsubscribe handle. */
  onDiagnostics(listener: (diagnostics: readonly LspDiagnostic[]) => void): () => void;
}

export function createStubLspBridge(): LspBridge {
  let running = false;
  return {
    async start(): Promise<void> {
      running = true;
    },
    async stop(): Promise<void> {
      running = false;
    },
    isRunning(): boolean {
      return running;
    },
    onDiagnostics(): () => void {
      return () => {};
    },
  };
}
