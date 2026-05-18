import type { ZodError } from 'zod';
import type { LLMProvider, ProviderConfig, ProviderFactory } from './provider';

export class ProviderConfigError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly issues: ZodError['issues'],
  ) {
    super(
      `Invalid config for provider "${providerId}": ${issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
    );
    this.name = 'ProviderConfigError';
  }
}

export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();

  register(factory: ProviderFactory): void {
    if (this.factories.has(factory.id)) {
      throw new Error(`Provider "${factory.id}" already registered`);
    }
    this.factories.set(factory.id, factory as ProviderFactory);
  }

  unregister(id: string): boolean {
    return this.factories.delete(id);
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  get(id: string): ProviderFactory | undefined {
    return this.factories.get(id);
  }

  list(): ProviderFactory[] {
    return Array.from(this.factories.values());
  }

  create(id: string, config: ProviderConfig): LLMProvider {
    const factory = this.factories.get(id);
    if (!factory) {
      throw new Error(`Provider "${id}" is not registered`);
    }
    const parsed = factory.configSchema.safeParse(config);
    if (!parsed.success) {
      throw new ProviderConfigError(id, parsed.error.issues);
    }
    return factory.create(parsed.data);
  }
}
