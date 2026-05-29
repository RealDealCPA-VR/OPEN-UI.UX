import type { ChatEvent } from './events';
import type { ModelCapabilities } from './capabilities';
import type { ChatRequest, EmbedRequest, EmbedResult, LLMProvider } from './provider';
import {
  findRuleFor,
  type ProviderModelRef,
  type RoutingDecision,
  type RoutingPolicy,
  type RoutingRule,
  type RoutingRuleWhen,
} from './routing';

export type RoutingDecisionListener = (decision: RoutingDecision) => void;

export interface RoutingProviderOptions {
  defaultRef: ProviderModelRef;
  policy: RoutingPolicy;
  providers: ReadonlyMap<string, LLMProvider>;
  detectSensitivePath?: (req: ChatRequest) => boolean;
  onDecision?: RoutingDecisionListener;
  displayName?: string;
}

export class RoutingProvider implements LLMProvider {
  readonly id: string = 'routing';
  readonly displayName: string;
  private readonly defaultRef: ProviderModelRef;
  private readonly policy: RoutingPolicy;
  private readonly providers: ReadonlyMap<string, LLMProvider>;
  private readonly detectSensitivePath?: (req: ChatRequest) => boolean;
  private readonly onDecision?: RoutingDecisionListener;

  constructor(opts: RoutingProviderOptions) {
    this.defaultRef = opts.defaultRef;
    this.policy = opts.policy;
    this.providers = opts.providers;
    this.displayName = opts.displayName ?? `Routing(${opts.policy.name})`;
    if (opts.detectSensitivePath) this.detectSensitivePath = opts.detectSensitivePath;
    if (opts.onDecision) this.onDecision = opts.onDecision;
  }

  chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    const trait = this.classifyChat(req);
    const decision = this.resolve(trait);
    const provider = this.providers.get(decision.providerId);
    if (!provider) {
      return errorOnce(`RoutingProvider: provider "${decision.providerId}" is not available`);
    }
    this.emitDecision(decision);
    return provider.chat({ ...req, model: decision.modelId });
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const decision = this.resolve('embedding');
    const provider = this.providers.get(decision.providerId);
    if (!provider) {
      throw new Error(
        `RoutingProvider: provider "${decision.providerId}" is not available for embeddings`,
      );
    }
    this.emitDecision(decision);
    return provider.embed({ ...req, model: decision.modelId });
  }

  async listModels(): Promise<ModelCapabilities[]> {
    const out: ModelCapabilities[] = [];
    for (const provider of this.providers.values()) {
      try {
        const models = await provider.listModels();
        out.push(...models);
      } catch {
        // ignore per-provider failures so routing introspection stays best-effort
      }
    }
    return out;
  }

  async capabilities(model: string): Promise<ModelCapabilities | undefined> {
    for (const provider of this.providers.values()) {
      try {
        const cap = await provider.capabilities(model);
        if (cap) return cap;
      } catch {
        // continue
      }
    }
    return undefined;
  }

  decideForChat(req: ChatRequest): RoutingDecision {
    return this.resolve(this.classifyChat(req));
  }

  decideForEmbedding(): RoutingDecision {
    return this.resolve('embedding');
  }

  private classifyChat(req: ChatRequest): RoutingRuleWhen | null {
    if (this.detectSensitivePath?.(req)) return 'sensitive_path';
    if (req.tools && req.tools.length > 0) return 'tool_call';
    if (hasReasoningSignal(req)) return 'reasoning';
    return null;
  }

  private resolve(trait: RoutingRuleWhen | null): RoutingDecision {
    if (trait === null) {
      return {
        matched: null,
        ruleId: null,
        providerId: this.defaultRef.providerId,
        modelId: this.defaultRef.modelId,
        usedFallback: false,
      };
    }
    const rule = findRuleFor(this.policy, trait);
    if (!rule) {
      return {
        matched: null,
        ruleId: null,
        providerId: this.defaultRef.providerId,
        modelId: this.defaultRef.modelId,
        usedFallback: false,
      };
    }
    return this.applyRule(rule, trait);
  }

  private applyRule(rule: RoutingRule, trait: RoutingRuleWhen): RoutingDecision {
    const primary = rule.use;
    if (this.providers.has(primary.providerId)) {
      return {
        matched: trait,
        ruleId: rule.id,
        providerId: primary.providerId,
        modelId: primary.modelId,
        usedFallback: false,
      };
    }
    if (rule.fallback && this.providers.has(rule.fallback.providerId)) {
      return {
        matched: trait,
        ruleId: rule.id,
        providerId: rule.fallback.providerId,
        modelId: rule.fallback.modelId,
        usedFallback: true,
      };
    }
    return {
      matched: trait,
      ruleId: rule.id,
      providerId: this.defaultRef.providerId,
      modelId: this.defaultRef.modelId,
      usedFallback: true,
    };
  }

  private emitDecision(decision: RoutingDecision): void {
    if (!this.onDecision) return;
    try {
      this.onDecision(decision);
    } catch {
      // never let observer errors break dispatch
    }
  }
}

function hasReasoningSignal(req: ChatRequest): boolean {
  const flagged = req as unknown as { reasoning?: unknown; hasReasoning?: unknown };
  if (flagged.reasoning === true) return true;
  if (flagged.hasReasoning === true) return true;
  if (typeof flagged.reasoning === 'object' && flagged.reasoning !== null) return true;
  return false;
}

async function* errorOnce(message: string): AsyncIterable<ChatEvent> {
  yield { type: 'error', message, retryable: false };
  yield { type: 'done', stopReason: 'error' };
}
