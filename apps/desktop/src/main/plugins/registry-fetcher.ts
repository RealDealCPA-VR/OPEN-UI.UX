import { z } from 'zod';
import { PermissionSchema } from '@opencodex/plugin-sdk';

export const RegistryContributionSummarySchema = z.object({
  tools: z.array(z.string()).optional(),
  providers: z.array(z.string()).optional(),
  runners: z.array(z.string()).optional(),
  panels: z.array(z.string()).optional(),
  slashCommands: z.array(z.string()).optional(),
});

export const PluginRegistryEntrySchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  homepage: z.string().url().optional(),
  installUrl: z.string().url(),
  permissions: z.array(PermissionSchema).default([]),
  contributions: RegistryContributionSummarySchema.default({}),
  signature: z.string().optional(),
  signer: z.string().optional(),
  publishedAt: z.string().optional(),
  downloads: z.number().int().nonnegative().optional(),
});

export type PluginRegistryEntry = z.infer<typeof PluginRegistryEntrySchema>;

export const PluginRegistrySchema = z.object({
  schemaVersion: z.literal(1).default(1),
  entries: z.array(PluginRegistryEntrySchema),
});

export type PluginRegistry = z.infer<typeof PluginRegistrySchema>;

export interface FetchRegistryResult {
  entries: PluginRegistryEntry[];
  error: string | null;
}

export type FetchImpl = (url: string) => Promise<Response>;

export async function fetchPluginRegistry(
  url: string,
  fetchImpl: FetchImpl = fetch,
): Promise<FetchRegistryResult> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { entries: [], error: `HTTP ${response.status}` };
    }
    const raw: unknown = await response.json();
    // Accept either a bare array (legacy) or a versioned envelope.
    if (Array.isArray(raw)) {
      const items: PluginRegistryEntry[] = [];
      for (const item of raw) {
        const parsed = PluginRegistryEntrySchema.safeParse(item);
        if (parsed.success) items.push(parsed.data);
      }
      return { entries: items, error: null };
    }
    const parsed = PluginRegistrySchema.safeParse(raw);
    if (!parsed.success) {
      return { entries: [], error: `invalid registry shape: ${parsed.error.message}` };
    }
    return { entries: parsed.data.entries, error: null };
  } catch (err) {
    return {
      entries: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
