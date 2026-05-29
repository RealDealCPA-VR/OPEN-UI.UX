import { z } from 'zod';

export const memoryBackendIdSchema = z.enum(['obsidian', 'notion', 'local-fs']);
export type MemoryBackendId = z.infer<typeof memoryBackendIdSchema>;

export const obsidianBackendConfigSchema = z.object({
  enabled: z.boolean().default(false),
  vaultPath: z.string().default(''),
});

export const notionBackendConfigSchema = z.object({
  enabled: z.boolean().default(false),
  workspaceName: z.string().optional(),
});

// Lane 7 — local-fs backend (per-workspace memory.md)
export const localFsBackendConfigSchema = z.object({
  enabled: z.boolean().default(false),
  prependToSystemPrompt: z.boolean().default(false),
  maxPrependBytes: z.number().int().min(256).max(65536).default(4096),
});

export type LocalFsBackendConfig = z.infer<typeof localFsBackendConfigSchema>;

export const memoryConfigSchema = z.object({
  backends: z
    .object({
      obsidian: obsidianBackendConfigSchema.default({ enabled: false, vaultPath: '' }),
      notion: notionBackendConfigSchema.default({ enabled: false }),
      localFs: localFsBackendConfigSchema.default({
        enabled: false,
        prependToSystemPrompt: false,
        maxPrependBytes: 4096,
      }),
    })
    .default({
      obsidian: { enabled: false, vaultPath: '' },
      notion: { enabled: false },
      localFs: { enabled: false, prependToSystemPrompt: false, maxPrependBytes: 4096 },
    }),
});

export type ObsidianBackendConfig = z.infer<typeof obsidianBackendConfigSchema>;
export type NotionBackendConfig = z.infer<typeof notionBackendConfigSchema>;
export type MemoryConfig = z.infer<typeof memoryConfigSchema>;

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = memoryConfigSchema.parse({});

export const memoryBackendStatusSchema = z.object({
  id: memoryBackendIdSchema,
  enabled: z.boolean(),
  registered: z.boolean(),
  configured: z.boolean(),
  toolCount: z.number().int().nonnegative(),
  lastError: z.string().optional(),
});

export const memoryStatusSchema = z.object({
  config: memoryConfigSchema,
  hasNotionToken: z.boolean(),
  backends: z.array(memoryBackendStatusSchema),
});

export type MemoryBackendStatus = z.infer<typeof memoryBackendStatusSchema>;
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;

export const testConnectionResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  detail: z
    .object({
      noteCount: z.number().int().nonnegative().optional(),
      userName: z.string().optional(),
    })
    .optional(),
});

export type TestConnectionResult = z.infer<typeof testConnectionResultSchema>;

const strictObsidianConfigSchema = z.object({
  enabled: z.boolean(),
  vaultPath: z.string(),
});

const strictNotionConfigSchema = z.object({
  enabled: z.boolean(),
  workspaceName: z.string().optional(),
});

const strictLocalFsConfigSchema = z.object({
  enabled: z.boolean(),
  prependToSystemPrompt: z.boolean(),
  maxPrependBytes: z.number().int(),
});

const strictMemoryConfigSchema = z.object({
  backends: z.object({
    obsidian: strictObsidianConfigSchema,
    notion: strictNotionConfigSchema,
    localFs: strictLocalFsConfigSchema,
  }),
});

export const setMemoryConfigRequestSchema = z.object({
  config: strictMemoryConfigSchema,
});

export type SetMemoryConfigRequest = { config: MemoryConfig };

export const testMemoryConnectionRequestSchema = z.object({
  backend: memoryBackendIdSchema,
});

export type TestMemoryConnectionRequest = z.infer<typeof testMemoryConnectionRequestSchema>;

export const setNotionTokenRequestSchema = z.object({
  token: z.string().min(1),
});

export type SetNotionTokenRequest = z.infer<typeof setNotionTokenRequestSchema>;

export interface MemoryConfigChangedEvent {
  status: MemoryStatus;
}
