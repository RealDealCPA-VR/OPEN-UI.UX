import { z } from 'zod';
import { definePlugin } from '@opencodex/plugin-sdk';
import type {
  ChatEvent,
  ChatRequest,
  EmbedRequest,
  EmbedResult,
  LLMProvider,
  ModelCapabilities,
  ProviderFactory,
} from '@opencodex/core';

const configSchema = z.object({});

class EchoProvider implements LLMProvider {
  readonly id = 'echo';
  readonly displayName = 'Echo (example)';

  async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    const last = req.messages[req.messages.length - 1];
    const text = last && typeof last.content === 'string' ? last.content : 'echo: nothing to say';
    for (const ch of text) {
      yield { type: 'text_delta', delta: ch };
    }
    yield { type: 'usage', inputTokens: text.length, outputTokens: text.length };
    yield { type: 'done', stopReason: 'end_turn' };
  }

  async embed(_req: EmbedRequest): Promise<EmbedResult> {
    throw new Error('echo provider has no embeddings');
  }

  async listModels(): Promise<ModelCapabilities[]> {
    return [
      {
        id: 'echo-1',
        providerId: 'echo',
        displayName: 'Echo v1',
        toolUse: false,
        vision: false,
        streaming: true,
        embeddings: false,
        contextWindow: 4096,
      },
    ];
  }

  async capabilities(model: string): Promise<ModelCapabilities | undefined> {
    return (await this.listModels()).find((m) => m.id === model);
  }
}

const echoProvider: ProviderFactory = {
  id: 'echo',
  displayName: 'Echo (example)',
  configSchema,
  create() {
    return new EchoProvider();
  },
};

export default definePlugin({
  activate(host) {
    host.registerProvider(echoProvider);
    host.logger.info('echo provider registered');
  },
});
