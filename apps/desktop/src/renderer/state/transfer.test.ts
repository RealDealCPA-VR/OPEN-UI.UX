import { describe, expect, it, beforeEach } from 'vitest';
import { __resetTransferForTests, consumeTransfer, peekTransfer, pushTransfer } from './transfer';
import type { TransferContext } from '../../shared/transfer-context';

const sample: TransferContext = {
  kind: 'chat-to-agent',
  conversationId: 'c1',
  lastUserMessage: 'do thing',
  workspaceRoot: '/repo',
};

describe('transfer store', () => {
  beforeEach(() => __resetTransferForTests());

  it('starts empty', () => {
    expect(peekTransfer()).toBeNull();
    expect(consumeTransfer()).toBeNull();
  });

  it('push + consume round-trips', () => {
    pushTransfer(sample);
    expect(peekTransfer()).toEqual(sample);
    expect(consumeTransfer()).toEqual(sample);
    expect(peekTransfer()).toBeNull();
  });

  it('a second consume returns null', () => {
    pushTransfer(sample);
    expect(consumeTransfer()).toEqual(sample);
    expect(consumeTransfer()).toBeNull();
  });

  it('push overwrites the previous unconsumed transfer', () => {
    pushTransfer(sample);
    const next: TransferContext = { kind: 'codebase-to-chat', filePath: 'src/a.ts' };
    pushTransfer(next);
    expect(peekTransfer()).toEqual(next);
  });
});
