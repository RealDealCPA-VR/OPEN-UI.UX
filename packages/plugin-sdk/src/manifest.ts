import { z } from 'zod';

export const PermissionSchema = z.enum([
  'workspace.read',
  'workspace.write',
  'shell.execute',
  'network.fetch',
  'settings.read',
  'settings.write',
  'ui.panel',
]);

export type Permission = z.infer<typeof PermissionSchema>;

export const ContributionSchema = z.object({
  tools: z.array(z.string()).optional(),
  providers: z.array(z.string()).optional(),
  panels: z
    .array(z.object({ id: z.string(), title: z.string(), entry: z.string() }))
    .optional(),
  slashCommands: z.array(z.object({ name: z.string(), entry: z.string() })).optional(),
});

export const ManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  homepage: z.string().url().optional(),
  entry: z.string(),
  engines: z.object({ opencodex: z.string() }),
  permissions: z.array(PermissionSchema).default([]),
  contributions: ContributionSchema.default({}),
});

export type PluginManifest = z.infer<typeof ManifestSchema>;
