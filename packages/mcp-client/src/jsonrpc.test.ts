import { describe, expect, it } from 'vitest';
import {
  isNotification,
  isRequest,
  isResponse,
  JsonRpcError,
  jsonRpcResponseSchema,
} from './jsonrpc';

describe('jsonrpc helpers', () => {
  it('classifies requests', () => {
    expect(isRequest({ jsonrpc: '2.0', id: 1, method: 'foo', params: {} })).toBe(true);
    expect(isRequest({ jsonrpc: '2.0', method: 'foo' })).toBe(false);
    expect(isRequest({ jsonrpc: '2.0', id: 1, result: {} })).toBe(false);
  });

  it('classifies notifications', () => {
    expect(isNotification({ jsonrpc: '2.0', method: 'note', params: {} })).toBe(true);
    expect(isNotification({ jsonrpc: '2.0', id: 1, method: 'foo' })).toBe(false);
  });

  it('classifies responses', () => {
    expect(isResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } })).toBe(true);
    expect(isResponse({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'unknown' } })).toBe(
      true,
    );
    expect(isResponse({ jsonrpc: '2.0', method: 'foo' })).toBe(false);
  });

  it('parses error payloads', () => {
    const parsed = jsonRpcResponseSchema.parse({
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32000, message: 'boom', data: { trace: 'stack' } },
    });
    expect(parsed.error?.code).toBe(-32000);
  });

  it('JsonRpcError carries code + data', () => {
    const err = new JsonRpcError(-32601, 'method not found', { hint: 'init' });
    expect(err.code).toBe(-32601);
    expect(err.data).toEqual({ hint: 'init' });
  });

  it('rejects ambiguous messages with both result and method', () => {
    const ambiguous = { jsonrpc: '2.0', id: 1, method: 'foo', result: {} };
    expect(isRequest(ambiguous)).toBe(false);
    expect(isResponse(ambiguous)).toBe(false);
    expect(isNotification(ambiguous)).toBe(false);
  });

  it('rejects ambiguous messages with both error and method', () => {
    const ambiguous = {
      jsonrpc: '2.0',
      id: 1,
      method: 'foo',
      error: { code: -1, message: 'x' },
    };
    expect(isRequest(ambiguous)).toBe(false);
    expect(isResponse(ambiguous)).toBe(false);
    expect(isNotification(ambiguous)).toBe(false);
  });

  it('rejects responses lacking result and error', () => {
    expect(isResponse({ jsonrpc: '2.0', id: 1 })).toBe(false);
  });
});
