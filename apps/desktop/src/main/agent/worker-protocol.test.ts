import { describe, expect, it } from 'vitest';
import {
  workerErrorMessageSchema,
  workerEventMessageSchema,
  workerOutboundMessageSchema,
  workerReadyMessageSchema,
  workerResultMessageSchema,
  workerStartMessageSchema,
} from './worker-protocol';

describe('worker-protocol', () => {
  describe('workerStartMessageSchema', () => {
    it('accepts a minimal valid start payload', () => {
      const parsed = workerStartMessageSchema.safeParse({
        kind: 'start',
        task: 'do the thing',
        providerId: 'openai',
        modelId: 'gpt-4o-mini',
        workspaceRoot: '/tmp/ws',
      });
      expect(parsed.success).toBe(true);
    });

    it('accepts optional budget + allowedToolNames + systemPrompt', () => {
      const parsed = workerStartMessageSchema.safeParse({
        kind: 'start',
        task: 'do',
        providerId: 'openai',
        modelId: 'gpt-4o',
        workspaceRoot: '/ws',
        allowedToolNames: ['read_file'],
        budget: { maxTokens: 1000, maxToolIterations: 3, maxWallTimeMs: 5000 },
        systemPrompt: 'be terse',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.allowedToolNames).toEqual(['read_file']);
        expect(parsed.data.budget?.maxTokens).toBe(1000);
      }
    });

    it('rejects missing required fields', () => {
      const parsed = workerStartMessageSchema.safeParse({
        kind: 'start',
        task: 'x',
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects wrong kind', () => {
      const parsed = workerStartMessageSchema.safeParse({
        kind: 'result',
        task: 'x',
        providerId: 'a',
        modelId: 'b',
        workspaceRoot: '/',
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects empty task', () => {
      const parsed = workerStartMessageSchema.safeParse({
        kind: 'start',
        task: '',
        providerId: 'openai',
        modelId: 'gpt-4o',
        workspaceRoot: '/ws',
      });
      expect(parsed.success).toBe(false);
    });

    it('accepts an explicit runnerId', () => {
      const parsed = workerStartMessageSchema.safeParse({
        kind: 'start',
        task: 'do',
        providerId: 'openai',
        modelId: 'gpt-4o',
        workspaceRoot: '/ws',
        runnerId: 'claude-code',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.runnerId).toBe('claude-code');
    });

    it("defaults runnerId to 'internal' when omitted", () => {
      const parsed = workerStartMessageSchema.safeParse({
        kind: 'start',
        task: 'do',
        providerId: 'openai',
        modelId: 'gpt-4o',
        workspaceRoot: '/ws',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.runnerId).toBe('internal');
    });

    it('rejects non-string runnerId', () => {
      const parsed = workerStartMessageSchema.safeParse({
        kind: 'start',
        task: 'do',
        providerId: 'openai',
        modelId: 'gpt-4o',
        workspaceRoot: '/ws',
        runnerId: 123,
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects empty-string runnerId', () => {
      const parsed = workerStartMessageSchema.safeParse({
        kind: 'start',
        task: 'do',
        providerId: 'openai',
        modelId: 'gpt-4o',
        workspaceRoot: '/ws',
        runnerId: '',
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('stopReason vocabulary (via workerResultMessageSchema.stopReason)', () => {
    function parseStop(stopReason: string) {
      return workerResultMessageSchema.safeParse({
        kind: 'result',
        text: '',
        toolEvents: [],
        inputTokens: 0,
        outputTokens: 0,
        stopReason,
        iterations: 0,
      });
    }

    it("accepts 'runner_error'", () => {
      const parsed = parseStop('runner_error');
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.stopReason).toBe('runner_error');
    });

    it("accepts 'runner_not_installed'", () => {
      const parsed = parseStop('runner_not_installed');
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.stopReason).toBe('runner_not_installed');
    });

    it("accepts 'cancelled'", () => {
      const parsed = parseStop('cancelled');
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.stopReason).toBe('cancelled');
    });

    it("rejects an unknown stop reason like 'totally_made_up'", () => {
      const parsed = parseStop('totally_made_up');
      expect(parsed.success).toBe(false);
    });
  });

  describe('workerResultMessageSchema', () => {
    it('accepts a full result', () => {
      const parsed = workerResultMessageSchema.safeParse({
        kind: 'result',
        text: 'done',
        toolEvents: [
          { name: 'read_file', input: { path: 'a' }, output: 'x', isError: false, durationMs: 5 },
        ],
        inputTokens: 10,
        outputTokens: 20,
        stopReason: 'end_turn',
        iterations: 2,
      });
      expect(parsed.success).toBe(true);
    });

    it('accepts optional error', () => {
      const parsed = workerResultMessageSchema.safeParse({
        kind: 'result',
        text: '',
        toolEvents: [],
        inputTokens: 0,
        outputTokens: 0,
        stopReason: 'error',
        error: 'boom',
        iterations: 0,
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects invalid stopReason', () => {
      const parsed = workerResultMessageSchema.safeParse({
        kind: 'result',
        text: '',
        toolEvents: [],
        inputTokens: 0,
        outputTokens: 0,
        stopReason: 'completed',
        iterations: 0,
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('workerEventMessageSchema', () => {
    it('parses a tool event', () => {
      const parsed = workerEventMessageSchema.safeParse({
        kind: 'event',
        event: { name: 't', input: 1, output: 2, isError: false, durationMs: 1 },
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe('workerErrorMessageSchema', () => {
    it('parses a worker error', () => {
      const parsed = workerErrorMessageSchema.safeParse({ kind: 'error', message: 'bad' });
      expect(parsed.success).toBe(true);
    });

    it('rejects non-string message', () => {
      const parsed = workerErrorMessageSchema.safeParse({ kind: 'error', message: 42 });
      expect(parsed.success).toBe(false);
    });
  });

  describe('workerReadyMessageSchema', () => {
    it('parses a ready signal', () => {
      const parsed = workerReadyMessageSchema.safeParse({ kind: 'ready' });
      expect(parsed.success).toBe(true);
    });
  });

  describe('workerOutboundMessageSchema (discriminated union)', () => {
    it('discriminates on kind: ready', () => {
      const parsed = workerOutboundMessageSchema.safeParse({ kind: 'ready' });
      expect(parsed.success).toBe(true);
    });

    it('discriminates on kind: result', () => {
      const parsed = workerOutboundMessageSchema.safeParse({
        kind: 'result',
        text: 'ok',
        toolEvents: [],
        inputTokens: 0,
        outputTokens: 0,
        stopReason: 'end_turn',
        iterations: 1,
      });
      expect(parsed.success).toBe(true);
    });

    it('discriminates on kind: error', () => {
      const parsed = workerOutboundMessageSchema.safeParse({ kind: 'error', message: 'x' });
      expect(parsed.success).toBe(true);
    });

    it('discriminates on kind: event', () => {
      const parsed = workerOutboundMessageSchema.safeParse({
        kind: 'event',
        event: { name: 't', input: null, output: null, isError: false, durationMs: 0 },
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects unknown kinds', () => {
      const parsed = workerOutboundMessageSchema.safeParse({ kind: 'something-else' });
      expect(parsed.success).toBe(false);
    });
  });
});
