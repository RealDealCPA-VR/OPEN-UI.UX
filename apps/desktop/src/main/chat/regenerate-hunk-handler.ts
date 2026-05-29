import type { ChatEvent, LLMProvider, Message } from '@opencodex/core';
import { logger } from '../logger';
import type { RegenerateHunkRequest, RegenerateHunkResponse } from '../../shared/git-workflow';

export interface RegenerateHunkDeps {
  buildProvider: (providerId: string) => Promise<LLMProvider>;
}

function buildPrompt(req: RegenerateHunkRequest): Message[] {
  const lang = req.language ?? 'plaintext';
  const system: Message = {
    role: 'system',
    content:
      'You rewrite a single code hunk. Return ONLY the replacement code — no markdown fences, no explanation. Preserve indentation style.',
  };
  const user: Message = {
    role: 'user',
    content: `File: ${req.filePath}\nLanguage: ${lang}\n\nOriginal:\n\`\`\`${lang}\n${req.originalSnippet}\n\`\`\`\n\nCurrent draft:\n\`\`\`${lang}\n${req.modifiedSnippet}\n\`\`\`\n\nInstruction: ${req.instruction}\n\nReply with the replacement hunk only.`,
  };
  return [system, user];
}

function stripCodeFences(text: string): string {
  const fenceMatch = text.match(/^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) return fenceMatch[1] ?? text;
  return text.trim();
}

export async function regenerateHunk(
  req: RegenerateHunkRequest,
  deps: RegenerateHunkDeps,
): Promise<RegenerateHunkResponse> {
  try {
    const provider = await deps.buildProvider(req.providerId);
    const messages = buildPrompt(req);
    const collected: string[] = [];
    const stream = provider.chat({ model: req.modelId, messages });
    for await (const event of stream as AsyncIterable<ChatEvent>) {
      if (event.type === 'text_delta') collected.push(event.delta);
      else if (event.type === 'error') return { ok: false, error: event.message };
      else if (event.type === 'done') break;
    }
    const suggestion = stripCodeFences(collected.join(''));
    return { ok: true, suggestion };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message, filePath: req.filePath }, 'regenerateHunk failed');
    return { ok: false, error: message };
  }
}
