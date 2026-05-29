/**
 * Validate an API key shape: must be non-empty and not just whitespace.
 * Throws a clear error if invalid. Provider constructors should call this
 * when a key is supplied so misconfiguration surfaces at create-time, not
 * mid-stream.
 */
export function assertValidApiKey(key: unknown, providerLabel: string): void {
  if (key === undefined || key === null) return;
  if (typeof key !== 'string') {
    throw new Error(`${providerLabel} apiKey must be a string`);
  }
  if (key.length === 0 || key.trim().length === 0) {
    throw new Error(`${providerLabel} apiKey is empty or whitespace`);
  }
}

/**
 * Compute the costUsd for a usage event given token counts and pricing.
 * Returns undefined if no pricing was provided. Uses cached input pricing
 * for cached tokens when available, falling back to the full input rate.
 */
export interface PricingInput {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  pricing?: {
    inputPerMillion: number;
    outputPerMillion: number;
    cachedInputPerMillion?: number;
  };
}

export function computeCostUsd(input: PricingInput): number | undefined {
  if (!input.pricing) return undefined;
  const pricing = input.pricing;
  const cached = input.cachedInputTokens ?? 0;
  const billedInput = Math.max(0, input.inputTokens - cached);
  const inputCost = (billedInput * pricing.inputPerMillion) / 1_000_000;
  const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion;
  const cachedCost = (cached * cachedRate) / 1_000_000;
  const outputCost = (input.outputTokens * pricing.outputPerMillion) / 1_000_000;
  return inputCost + cachedCost + outputCost;
}
