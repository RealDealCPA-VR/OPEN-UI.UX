import { z } from 'zod';

/**
 * Shared trigger model — discriminated union over all the ways an automation
 * (scheduled task, skill, webhook handler) can fire. All variants are wired
 * up: `manual` (Run-now only), `cron` (cron-parser), `file-change` (chokidar
 * + glob), `git-hook` (post-commit / pre-push wrapper installed in the
 * workspace `.git/hooks/`), and `webhook` (local HTTP listener with HMAC).
 *
 * `assertTriggerSupported(t)` is retained for backwards compatibility — it
 * is now a no-op since every variant has a runtime implementation.
 */

export const manualTriggerSchema = z.object({
  type: z.literal('manual'),
});

export const cronTriggerSchema = z.object({
  type: z.literal('cron'),
  expr: z.string().min(1),
  tz: z.string().min(1).optional(),
});

export const fileChangeTriggerSchema = z.object({
  type: z.literal('file-change'),
  glob: z.string().min(1),
});

export const gitHookTriggerSchema = z.object({
  type: z.literal('git-hook'),
  hook: z.enum(['post-commit', 'pre-push']),
  /**
   * Per-task HMAC secret used by the wrapper script to sign callbacks into
   * the local listener. Generated at task-create time; rotate by editing the
   * task. Optional for backwards compatibility with pre-Phase-8.75 rows.
   */
  hookSecret: z.string().min(1).optional(),
});

export const webhookTriggerSchema = z.object({
  type: z.literal('webhook'),
  secret: z.string().min(1),
});

export const triggerSchema = z.discriminatedUnion('type', [
  manualTriggerSchema,
  cronTriggerSchema,
  fileChangeTriggerSchema,
  gitHookTriggerSchema,
  webhookTriggerSchema,
]);

export type ManualTrigger = z.infer<typeof manualTriggerSchema>;
export type CronTrigger = z.infer<typeof cronTriggerSchema>;
export type FileChangeTrigger = z.infer<typeof fileChangeTriggerSchema>;
export type GitHookTrigger = z.infer<typeof gitHookTriggerSchema>;
export type WebhookTrigger = z.infer<typeof webhookTriggerSchema>;
export type Trigger = z.infer<typeof triggerSchema>;

export type TriggerType = Trigger['type'];

export const SUPPORTED_TRIGGER_TYPES: readonly TriggerType[] = [
  'manual',
  'cron',
  'file-change',
  'git-hook',
  'webhook',
];

export function isSupportedTrigger(t: Trigger): boolean {
  return SUPPORTED_TRIGGER_TYPES.includes(t.type);
}

export function assertTriggerSupported(t: Trigger): void {
  if (!isSupportedTrigger(t)) {
    throw new Error(`Not implemented: trigger type "${(t as Trigger).type}"`);
  }
}

export function parseTriggerJson(raw: string): Trigger {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid trigger JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = triggerSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`invalid trigger shape: ${result.error.message}`);
  }
  return result.data;
}

export function serializeTrigger(t: Trigger): string {
  return JSON.stringify(triggerSchema.parse(t));
}

export function describeTrigger(t: Trigger): string {
  switch (t.type) {
    case 'manual':
      return 'Manual';
    case 'cron':
      return t.tz ? `Cron: ${t.expr} (${t.tz})` : `Cron: ${t.expr}`;
    case 'file-change':
      return `File change: ${t.glob}`;
    case 'git-hook':
      return `Git hook: ${t.hook}`;
    case 'webhook':
      return 'Webhook';
    default: {
      const _exhaustive: never = t;
      void _exhaustive;
      return 'Trigger';
    }
  }
}
