import type { z } from 'zod';
import { zodToJsonSchema as convertWithLibrary } from 'zod-to-json-schema';

export interface JSONSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean | JSONSchema;
  enum?: readonly string[];
  format?: string;
  items?: JSONSchema;
  [key: string]: unknown;
}

export class UnsupportedZodTypeError extends Error {
  constructor(typeName: string) {
    super(`zodToJSONSchema: unsupported Zod type "${typeName}"`);
    this.name = 'UnsupportedZodTypeError';
  }
}

export function zodToJSONSchema(schema: z.ZodTypeAny): JSONSchema {
  const out = convertWithLibrary(schema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  if ('$schema' in out) delete out.$schema;
  return out as JSONSchema;
}
