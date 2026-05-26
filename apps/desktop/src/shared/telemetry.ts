import { z } from 'zod';

export const telemetryConfigSchema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().default(''),
  host: z.string().url().nullable().default(null),
});

export type TelemetryConfig = z.infer<typeof telemetryConfigSchema>;

export const telemetrySetConfigRequestSchema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().optional(),
  host: z.string().url().nullable().optional(),
});

export type TelemetrySetConfigRequest = z.infer<typeof telemetrySetConfigRequestSchema>;

export interface TelemetryConfigChangedEvent {
  config: TelemetryConfig;
}
