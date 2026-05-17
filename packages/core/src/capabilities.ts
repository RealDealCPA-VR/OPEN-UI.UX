export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
}

export interface ModelCapabilities {
  id: string;
  providerId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens?: number;
  toolUse: boolean;
  vision: boolean;
  streaming: boolean;
  embeddings: boolean;
  promptCaching?: boolean;
  pricing?: ModelPricing;
}
