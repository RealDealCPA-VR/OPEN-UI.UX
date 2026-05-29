import { z } from 'zod';

const permissionTierSchema = z.enum(['read', 'write', 'execute', 'network']);

export const PluginToolShape = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    permissionTier: permissionTierSchema,
    inputZod: z.unknown(),
    inputSchema: z.unknown(),
    execute: z.unknown(),
  })
  .passthrough()
  .refine((value) => typeof (value as { execute?: unknown }).execute === 'function', {
    message: 'tool.execute must be a function',
    path: ['execute'],
  })
  .refine(
    (value) => {
      const inputZod = (value as { inputZod?: unknown }).inputZod;
      return typeof inputZod === 'object' && inputZod !== null;
    },
    { message: 'tool.inputZod must be a Zod schema', path: ['inputZod'] },
  );

export const PluginProviderShape = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    configSchema: z.unknown(),
    create: z.unknown(),
  })
  .passthrough()
  .refine((value) => typeof (value as { create?: unknown }).create === 'function', {
    message: 'provider.create must be a function',
    path: ['create'],
  });

export const PluginRunnerShape = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    streaming: z.boolean(),
    run: z.unknown(),
    checkInstalled: z.unknown().optional(),
  })
  .passthrough()
  .refine((value) => typeof (value as { run?: unknown }).run === 'function', {
    message: 'runner.run must be a function (async generator)',
    path: ['run'],
  })
  .refine(
    (value) => {
      const v = value as { checkInstalled?: unknown };
      return v.checkInstalled === undefined || typeof v.checkInstalled === 'function';
    },
    {
      message: 'runner.checkInstalled, when present, must be a function',
      path: ['checkInstalled'],
    },
  );

export class PluginContractError extends Error {
  constructor(
    public readonly kind: 'tool' | 'provider' | 'runner',
    public readonly issues: z.ZodIssue[],
  ) {
    super(
      `plugin ${kind} failed runtime validation: ${issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
    );
    this.name = 'PluginContractError';
  }
}

export function assertPluginTool(input: unknown): void {
  const result = PluginToolShape.safeParse(input);
  if (!result.success) throw new PluginContractError('tool', result.error.issues);
}

export function assertPluginProvider(input: unknown): void {
  const result = PluginProviderShape.safeParse(input);
  if (!result.success) throw new PluginContractError('provider', result.error.issues);
}

export function assertPluginRunner(input: unknown): void {
  const result = PluginRunnerShape.safeParse(input);
  if (!result.success) throw new PluginContractError('runner', result.error.issues);
}
