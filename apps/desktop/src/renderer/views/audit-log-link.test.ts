import { describe, expect, it } from 'vitest';
import { buildConversationLink } from './AuditLogPanel';

describe('buildConversationLink', () => {
  it('builds a chat URL with conversationId and messageId query params', () => {
    expect(buildConversationLink('conv-1', 'msg-2')).toBe(
      '/chat?conversationId=conv-1&messageId=msg-2',
    );
  });

  it('encodes special characters in ids', () => {
    expect(buildConversationLink('a b', 'm/c')).toBe('/chat?conversationId=a+b&messageId=m%2Fc');
  });
});
