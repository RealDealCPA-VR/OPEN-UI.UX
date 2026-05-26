import { z } from 'zod';

export const crashReportingConfigSchema = z.object({
  enabled: z.boolean(),
  dsn: z.string().default(''),
  environment: z.string().default('production'),
});

export type CrashReportingConfig = z.infer<typeof crashReportingConfigSchema>;

export const crashReportingSetConfigRequestSchema = z.object({
  enabled: z.boolean().optional(),
  dsn: z.string().optional(),
  environment: z.string().optional(),
});

export type CrashReportingSetConfigRequest = z.infer<typeof crashReportingSetConfigRequestSchema>;

export interface CrashReportingConfigChangedEvent {
  config: CrashReportingConfig;
}
