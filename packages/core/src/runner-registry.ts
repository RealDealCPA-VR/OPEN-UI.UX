import type { SubagentRunner } from './runner';

export class RunnerAlreadyRegisteredError extends Error {
  readonly runnerId: string;

  constructor(id: string) {
    super(`Runner "${id}" already registered`);
    this.name = 'RunnerAlreadyRegisteredError';
    this.runnerId = id;
  }
}

export class RunnerRegistry {
  private readonly runners = new Map<string, SubagentRunner>();
  private readonly listeners = new Set<() => void>();

  register(runner: SubagentRunner): void {
    if (this.runners.has(runner.id)) {
      throw new RunnerAlreadyRegisteredError(runner.id);
    }
    this.runners.set(runner.id, runner);
    this.emitChange();
  }

  unregister(id: string): boolean {
    const removed = this.runners.delete(id);
    if (removed) this.emitChange();
    return removed;
  }

  has(id: string): boolean {
    return this.runners.has(id);
  }

  get(id: string): SubagentRunner | undefined {
    return this.runners.get(id);
  }

  list(): SubagentRunner[] {
    return Array.from(this.runners.values());
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener();
  }
}
