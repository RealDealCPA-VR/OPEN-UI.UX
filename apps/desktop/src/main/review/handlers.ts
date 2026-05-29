import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger';
import { registerInvoke } from '../ipc/registry';
import { buildProviderForId } from '../chat/provider-builder';
import { fetchReviewDiff } from './review-engine';
import { generateFindings } from './findings-generator';
import {
  fetchDiffRequestSchema,
  generateFindingsRequestSchema,
  postCommentsRequestSchema,
  type FetchDiffResponse,
  type GenerateFindingsResponse,
  type PostCommentsResponse,
} from '../../shared/review';

const execFileAsync = promisify(execFile);

async function postOneComment(cwd: string, prNumber: number, body: string): Promise<void> {
  await execFileAsync('gh', ['pr', 'comment', String(prNumber), '--body', body], {
    cwd,
    windowsHide: true,
  });
}

export function registerReviewHandlers(): void {
  registerInvoke(
    'review:fetch-diff',
    fetchDiffRequestSchema,
    async (req): Promise<FetchDiffResponse> => {
      const diff = await fetchReviewDiff(req.source);
      return { diff };
    },
  );

  registerInvoke(
    'review:generate-findings',
    generateFindingsRequestSchema,
    async (req): Promise<GenerateFindingsResponse> => {
      const provider = await buildProviderForId(req.providerId);
      const result = await generateFindings({
        diff: req.diff,
        provider,
        modelId: req.modelId,
        ...(req.extraContext !== undefined ? { extraContext: req.extraContext } : {}),
      });
      return {
        findings: result.findings,
        rawText: result.rawText,
        warning: result.warning,
      };
    },
  );

  registerInvoke(
    'review:post-comments',
    postCommentsRequestSchema,
    async (req): Promise<PostCommentsResponse> => {
      const cwd = req.cwd ?? process.cwd();
      const errors: PostCommentsResponse['errors'] = [];
      let postedCount = 0;
      for (const finding of req.findings) {
        const body = formatFindingForGithub(finding);
        try {
          await postOneComment(cwd, req.prNumber, body);
          postedCount++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn({ findingId: finding.id, err: message }, 'review:post-comments gh failure');
          errors.push({ findingId: finding.id, message });
        }
      }
      return { postedCount, errors };
    },
  );
}

function formatFindingForGithub(finding: {
  filePath: string;
  startLine: number;
  endLine: number;
  severity: string;
  title: string;
  rationale: string;
  suggestedFix: string | null;
}): string {
  const lineRange =
    finding.startLine === finding.endLine
      ? `L${finding.startLine}`
      : `L${finding.startLine}-L${finding.endLine}`;
  const lines: string[] = [
    `**[${finding.severity}] ${finding.title}**`,
    `\`${finding.filePath}:${lineRange}\``,
    '',
    finding.rationale,
  ];
  if (finding.suggestedFix) {
    lines.push('', 'Suggested fix:', '```', finding.suggestedFix, '```');
  }
  lines.push('', '_Posted via OpenCodex Reviewer_');
  return lines.join('\n');
}
