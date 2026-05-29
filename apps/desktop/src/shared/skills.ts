import { z } from 'zod';

/**
 * Frontmatter schema for a SKILL.md file. Skills are markdown templates with
 * YAML frontmatter that surface as `/skill:<name>` commands in the chat
 * composer. The body of the file is the prompt template — substituted at
 * invocation time with `{{arg}}` placeholders and built-in vars.
 */

export const skillScopeSchema = z.enum(['user', 'project']);
export type SkillScope = z.infer<typeof skillScopeSchema>;

export const skillArgumentSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'argument name must be a valid identifier'),
  description: z.string().optional().default(''),
  required: z.boolean().optional().default(true),
});
export type SkillArgument = z.infer<typeof skillArgumentSchema>;

export const skillFrontmatterSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, 'skill name must be kebab-case (lowercase, dashes only)'),
  description: z.string().min(1),
  triggers: z.array(z.string().min(1)).optional(),
  tools: z.array(z.string().min(1)).optional(),
  cron: z.string().min(1).optional(),
  runner: z.string().min(1).optional(),
  arguments: z.array(skillArgumentSchema).optional(),
});
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

export interface Skill {
  id: string;
  name: string;
  scope: SkillScope;
  description: string;
  frontmatter: SkillFrontmatter;
  body: string;
  sourcePath: string;
  disabled: boolean;
}

export interface CreateSkillFromTemplateRequest {
  name: string;
  scope?: SkillScope;
}

export interface ImportSkillFromUrlRequest {
  url: string;
}

export interface SetSkillEnabledRequest {
  id: string;
  enabled: boolean;
}

export interface OpenSkillInEditorRequest {
  id: string;
}

export interface SkillsChangedEvent {
  skills: Skill[];
}

export interface SkillsListResponse {
  skills: Skill[];
}

/**
 * Schema for a single entry returned by the community skill registry.
 * The registry URL (configurable; off by default) is fetched + Zod-validated
 * before any entry is shown to the user. `sourceUrl` is what the "Install"
 * button passes to the existing `skills:import-from-url` IPC.
 */
export const skillRegistryEntrySchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, 'skill name must be kebab-case'),
  description: z.string().min(1),
  sourceUrl: z.string().url(),
  author: z.string().optional(),
  version: z.string().optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'sha256 must be 64 lowercase hex chars')
    .optional(),
});
export type SkillRegistryEntry = z.infer<typeof skillRegistryEntrySchema>;
export const skillRegistrySchema = z.array(skillRegistryEntrySchema);

export interface SkillRegistryFetchResponse {
  entries: SkillRegistryEntry[];
  error: string | null;
}
