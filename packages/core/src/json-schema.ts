import type { z } from 'zod';

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
  return convert(schema);
}

function convert(schema: z.ZodTypeAny): JSONSchema {
  const def = schema._def as { typeName?: string; description?: string };
  const typeName = def.typeName ?? 'Unknown';
  const description = schema.description;

  switch (typeName) {
    case 'ZodObject':
      return withDescription(convertObject(schema as z.ZodObject<z.ZodRawShape>), description);
    case 'ZodString':
      return withDescription(convertString(schema as z.ZodString), description);
    case 'ZodNumber':
      return withDescription({ type: 'number' }, description);
    case 'ZodBoolean':
      return withDescription({ type: 'boolean' }, description);
    case 'ZodEnum':
      return withDescription(
        { type: 'string', enum: (schema as z.ZodEnum<[string, ...string[]]>).options },
        description,
      );
    case 'ZodArray':
      return withDescription(
        { type: 'array', items: convert((schema as z.ZodArray<z.ZodTypeAny>).element) },
        description,
      );
    case 'ZodOptional':
      return convert((schema as z.ZodOptional<z.ZodTypeAny>).unwrap());
    case 'ZodDefault':
      return convert((schema as z.ZodDefault<z.ZodTypeAny>).removeDefault());
    case 'ZodNullable':
      return convert((schema as z.ZodNullable<z.ZodTypeAny>).unwrap());
    case 'ZodRecord':
      return withDescription(
        convertRecord(schema as z.ZodRecord<z.ZodString, z.ZodTypeAny>),
        description,
      );
    default:
      throw new UnsupportedZodTypeError(typeName);
  }
}

function convertObject(schema: z.ZodObject<z.ZodRawShape>): JSONSchema {
  const shape = schema.shape;
  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    properties[key] = convert(value);
    if (!isOptional(value)) required.push(key);
  }
  const result: JSONSchema = { type: 'object', properties, additionalProperties: false };
  if (required.length > 0) result.required = required;
  return result;
}

function convertRecord(schema: z.ZodRecord<z.ZodString, z.ZodTypeAny>): JSONSchema {
  const valueType = (schema._def as { valueType: z.ZodTypeAny }).valueType;
  return { type: 'object', additionalProperties: convert(valueType) };
}

function convertString(schema: z.ZodString): JSONSchema {
  const checks = (schema._def as { checks?: Array<{ kind: string }> }).checks ?? [];
  const out: JSONSchema = { type: 'string' };
  for (const check of checks) {
    if (check.kind === 'url') out.format = 'uri';
    else if (check.kind === 'email') out.format = 'email';
    else if (check.kind === 'uuid') out.format = 'uuid';
  }
  return out;
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const typeName = (schema._def as { typeName?: string }).typeName;
  return typeName === 'ZodOptional' || typeName === 'ZodDefault';
}

function withDescription(out: JSONSchema, description: string | undefined): JSONSchema {
  if (description) out.description = description;
  return out;
}
