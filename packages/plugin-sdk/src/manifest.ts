import { z } from 'zod';

export const PermissionSchema = z.enum([
  'workspace.read',
  'workspace.write',
  'shell.execute',
  'network.fetch',
  'settings.read',
  'settings.write',
  'ui.panel',
  'agent.runner',
]);

export type Permission = z.infer<typeof PermissionSchema>;

const relativeEntryPath = z
  .string()
  .min(1)
  .refine(
    (value) => !/^[a-zA-Z]:[\\/]/.test(value) && !value.startsWith('/') && !value.startsWith('\\'),
    {
      message: 'entry path must be relative (no absolute paths)',
    },
  )
  .refine((value) => !value.split(/[\\/]/).some((segment) => segment === '..'), {
    message: 'entry path must not contain ".." segments',
  });

export const ContributionSchema = z
  .object({
    tools: z.array(z.string().min(1)).optional(),
    providers: z.array(z.string().min(1)).optional(),
    panels: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string().min(1),
            entry: relativeEntryPath,
          })
          .strict(),
      )
      .optional(),
    slashCommands: z
      .array(
        z
          .object({
            name: z.string().min(1),
            entry: relativeEntryPath,
          })
          .strict(),
      )
      .optional(),
    runners: z
      .array(
        z
          .object({
            id: z.string().min(1),
            displayName: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const ManifestSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().optional(),
    author: z.string().optional(),
    license: z.string().optional(),
    homepage: z.string().url().optional(),
    entry: relativeEntryPath,
    engines: z.object({ opencodex: z.string().min(1) }).strict(),
    permissions: z.array(PermissionSchema).default([]),
    contributions: ContributionSchema.default({}),
  })
  .strict();

export type PluginManifest = z.infer<typeof ManifestSchema>;
