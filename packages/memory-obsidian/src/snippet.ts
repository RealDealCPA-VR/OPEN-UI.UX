import { bestSnippet as base } from '@opencodex/memory-utils';

export function bestSnippet(body: string, query: string, radius = 100): string {
  return base(body, query, { radius, paragraphAware: true });
}
