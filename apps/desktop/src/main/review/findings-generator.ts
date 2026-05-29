import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ChatEvent, LLMProvider, Message } from '@opencodex/core';
import {
  reviewFindingSchema,
  reviewSeveritySchema,
  type ReviewDiff,
  type ReviewFinding,
} from '../../shared/review';

const REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer. Examine the provided unified diff and produce structured findings.

Output STRICT JSON only — no prose, no markdown fences. Shape:
{
  "findings": [
    {
      "filePath": "string — path from the diff",
      "startLine": 1,
      "endLine": 1,
      "severity": "bug" | "smell" | "style" | "nit",
      "title": "short summary",
      "rationale": "why this matters, 1-3 sentences",
      "suggestedFix": "concrete code or null",
      "retrievedContext": ["optional list of relevant file:line references"],
      "prompt": "the LLM-ready instruction a developer could paste back to fix it, or null"
    }
  ]
}

Severity rules:
- "bug": real correctness defect, crash, security, race, missing await, broken contract.
- "smell": maintainability problem, duplication, unclear naming, leaky abstraction.
- "style": formatting / lint-class issue that doesn't change behavior.
- "nit": tiny preference; should be rare.

Use the NEW (post-change) line numbers from the @@ header. Do not invent issues. Return an empty findings array if nothing is wrong.`;

const responseEnvelopeSchema = z.object({
  findings: z.array(
    z.object({
      filePath: z.string().min(1),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      severity: reviewSeveritySchema,
      title: z.string().min(1),
      rationale: z.string().min(1),
      suggestedFix: z.string().nullable().optional(),
      retrievedContext: z.array(z.string()).optional(),
      prompt: z.string().nullable().optional(),
    }),
  ),
});

export interface GenerateFindingsResult {
  findings: ReviewFinding[];
  rawText: string;
  warning: string | null;
  /** The exact system+user prompt sent to the LLM. Stamped onto each finding's `auditPrompt`. */
  auditPrompt: string;
  /** Extra material we put in front of the LLM (currently the reviewer notes). */
  auditRetrievedContext: string[];
}

export interface GenerateFindingsOptions {
  diff: ReviewDiff;
  provider: LLMProvider;
  modelId: string;
  extraContext?: string;
  signal?: AbortSignal;
  systemPrompt?: string;
}

function buildUserPrompt(diff: ReviewDiff, extraContext: string | undefined): string {
  const parts: string[] = [];
  if (diff.prUrl) parts.push(`PR URL: ${diff.prUrl}`);
  if (diff.prNumber !== null) parts.push(`PR #: ${diff.prNumber}`);
  if (diff.baseRef && diff.headRef) parts.push(`Range: ${diff.baseRef}...${diff.headRef}`);
  parts.push(`Files changed: ${diff.files.length}`);
  if (extraContext && extraContext.trim().length > 0) {
    parts.push(`Reviewer notes: ${extraContext.trim()}`);
  }
  parts.push('', 'Unified diff:', '```diff', diff.rawDiff, '```');
  return parts.join('\n');
}

export function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence && fence[1]) {
    const inner = fence[1].trim();
    if (inner.startsWith('{')) return inner;
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    return text.slice(first, last + 1);
  }
  return null;
}

export async function generateFindings(
  options: GenerateFindingsOptions,
): Promise<GenerateFindingsResult> {
  const system = options.systemPrompt ?? REVIEW_SYSTEM_PROMPT;
  const userPrompt = buildUserPrompt(options.diff, options.extraContext);
  const messages: Message[] = [
    { role: 'system', content: system },
    { role: 'user', content: userPrompt },
  ];
  const auditPrompt = `SYSTEM:\n${system}\n\nUSER:\n${userPrompt}`;
  const auditRetrievedContext: string[] =
    options.extraContext && options.extraContext.trim().length > 0
      ? [options.extraContext.trim()]
      : [];

  let buffer = '';
  let stopReason: string | null = null;
  const requestArgs: Parameters<LLMProvider['chat']>[0] = {
    model: options.modelId,
    messages,
    temperature: 0.1,
  };
  if (options.signal) requestArgs.signal = options.signal;
  const stream = options.provider.chat(requestArgs);

  for await (const event of stream as AsyncIterable<ChatEvent>) {
    if (event.type === 'text_delta') buffer += event.delta;
    else if (event.type === 'done') stopReason = event.stopReason;
    else if (event.type === 'error') {
      throw new Error(event.message);
    }
  }

  const json = extractJsonObject(buffer);
  if (!json) {
    return {
      findings: [],
      rawText: buffer,
      warning: `Provider did not return JSON (stopReason=${stopReason ?? 'unknown'})`,
      auditPrompt,
      auditRetrievedContext,
    };
  }

  let parsed: z.infer<typeof responseEnvelopeSchema>;
  try {
    parsed = responseEnvelopeSchema.parse(JSON.parse(json));
  } catch (err) {
    return {
      findings: [],
      rawText: buffer,
      warning: `Failed to parse findings JSON: ${err instanceof Error ? err.message : String(err)}`,
      auditPrompt,
      auditRetrievedContext,
    };
  }

  const findings: ReviewFinding[] = parsed.findings.map((f) =>
    reviewFindingSchema.parse({
      id: randomUUID(),
      filePath: f.filePath,
      startLine: f.startLine,
      endLine: Math.max(f.startLine, f.endLine),
      severity: f.severity,
      title: f.title,
      rationale: f.rationale,
      suggestedFix: f.suggestedFix ?? null,
      retrievedContext: f.retrievedContext ?? [],
      prompt: f.prompt ?? null,
      auditPrompt,
      auditRetrievedContext,
    }),
  );

  return { findings, rawText: buffer, warning: null, auditPrompt, auditRetrievedContext };
}
