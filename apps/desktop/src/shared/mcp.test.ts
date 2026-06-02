import { describe, expect, it } from 'vitest';
import { mcpHttpConfigSchema, mcpServerEntrySchema, mcpSseConfigSchema } from './mcp';

describe('mcp IPC schema hostAllowlist passthrough', () => {
  it('preserves hostAllowlist on http config', () => {
    const parsed = mcpHttpConfigSchema.parse({
      kind: 'http',
      url: 'http://192.168.1.10/mcp',
      hostAllowlist: ['192.168.1.10'],
    });
    expect(parsed.hostAllowlist).toEqual(['192.168.1.10']);
  });

  it('preserves hostAllowlist on sse config', () => {
    const parsed = mcpSseConfigSchema.parse({
      kind: 'sse',
      url: 'http://10.0.0.5/sse',
      hostAllowlist: ['10.0.0.5'],
    });
    expect(parsed.hostAllowlist).toEqual(['10.0.0.5']);
  });

  it('preserves hostAllowlist through the full server entry parse (IPC boundary)', () => {
    const parsed = mcpServerEntrySchema.parse({
      id: 'lan',
      displayName: 'LAN MCP',
      config: {
        kind: 'http',
        url: 'http://192.168.1.10/mcp',
        hostAllowlist: ['192.168.1.10'],
      },
    });
    expect(parsed.config.kind).toBe('http');
    if (parsed.config.kind === 'http') {
      expect(parsed.config.hostAllowlist).toEqual(['192.168.1.10']);
    }
  });
});
