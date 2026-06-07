import type { ModelCapabilities } from '@opencodex/core';

export interface ProviderExtraField {
  name: string;
  label: string;
  type: 'text' | 'password';
  required: boolean;
  placeholder?: string;
  description?: string;
}

export interface ProviderInfo {
  id: string;
  displayName: string;
  requiresApiKey: boolean;
  defaultBaseUrl: string;
  extraFields: ProviderExtraField[];
  models: ModelCapabilities[];
  source?: 'plugin';
}

export interface ProviderStatus {
  hasApiKey: boolean;
  baseUrl: string | null;
  extra: Record<string, string>;
  lastTestedAt: string | null;
  lastTestResult: ProviderTestResult | null;
}

export interface ProviderListItem {
  info: ProviderInfo;
  status: ProviderStatus;
}

export interface ProviderSaveRequest {
  id: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  extra?: Record<string, string>;
}

export interface ProviderDeleteRequest {
  id: string;
}

export interface ProviderTestRequest {
  id: string;
}

export type ProviderTestResultCode =
  | 'ok'
  | 'config'
  | 'auth'
  | 'http'
  | 'network'
  | 'timeout'
  | 'unknown';

export interface ProviderTestResult {
  code: ProviderTestResultCode;
  ok: boolean;
  message: string;
  httpStatus?: number;
}

export interface ProviderSaveResponse {
  item: ProviderListItem;
  errors: ProviderConfigIssue[];
}

export interface ProviderConfigIssue {
  path: string;
  message: string;
}
