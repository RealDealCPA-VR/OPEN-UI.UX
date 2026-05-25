import { z } from 'zod';

export const JSONRPC_VERSION = '2.0';

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.unknown().optional(),
});

export const jsonRpcNotificationSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  method: z.string(),
  params: z.unknown().optional(),
});

export const jsonRpcErrorObjectSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const jsonRpcResponseSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: jsonRpcErrorObjectSchema.optional(),
});

export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;
export type JsonRpcNotification = z.infer<typeof jsonRpcNotificationSchema>;
export type JsonRpcResponse = z.infer<typeof jsonRpcResponseSchema>;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export class JsonRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

export function isResponse(message: unknown): message is JsonRpcResponse {
  return jsonRpcResponseSchema.safeParse(message).success;
}

export function isNotification(message: unknown): message is JsonRpcNotification {
  if (typeof message !== 'object' || message === null) return false;
  if ('id' in message) return false;
  return jsonRpcNotificationSchema.safeParse(message).success;
}

export function isRequest(message: unknown): message is JsonRpcRequest {
  if (typeof message !== 'object' || message === null) return false;
  if (!('id' in message)) return false;
  return jsonRpcRequestSchema.safeParse(message).success;
}
