import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ChatEvent, LLMProvider, Message } from '@opencodex/core';
import { logger } from '../logger';
import type {
  GitDraftPrRequest,
  GitDraftPrResponse,
  GitOpenPrInBrowserRequest,
  GitOpenPrInBrowserResponse,
} from '../../shared/git-workflow';

const execFileAsync = promisify(execFile);

const DEFAULT_RECENT_MESSAGES = 6;
const DIFF_TRUNCATE_CHARS = 12_000;

const SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'aws-secret', re: /\baws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{30,}["']?/gi },
  { name: 'github-pat', re: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { name: 'github-oauth', re: /\bgho_[A-Za-z0-9]{20,}\b/g },
  { name: 'github-user', re: /\bghu_[A-Za-z0-9]{20,}\b/g },
  { name: 'github-server', re: /\bghs_[A-Za-z0-9]{20,}\b/g },
  { name: 'github-refresh', re: /\bghr_[A-Za-z0-9]{20,}\b/g },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  {
    name: 'private-key',
    re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/g,
  },
  { name: 'password-kv', re: /"(password|passwd|secret|api[_-]?key|token)"\s*:\s*"[^"]+"/gi },
  { name: 'password-env', re: /\b(?:PASSWORD|SECRET|API_KEY|TOKEN|ACCESS_KEY)\s*=\s*[^\s\n]+/gi },
  { name: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g },
  { name: 'basic-auth', re: /\bBasic\s+[A-Za-z0-9+/]{20,}=*/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'url-creds', re: /\b(https?|ftp|git|ssh):\/\/[^\s:@]+:[^\s@]+@[^\s]+/g },
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const { name, re } of SECRET_PATTERNS) {
    out = out.replace(re, `[redacted:${name}]`);
  }
  return out;
}

export interface DraftPrDeps {
  buildProvider: (providerId: string) => Promise<LLMProvider>;
  fetchRecentMessages: (
    conversationId: string,
    count: number,
  ) => Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>;
  fetchDiff?: (repoRoot: string, branch: string, baseBranch: string) => Promise<string>;
  resolveDefaultProvider: () => { providerId: string; modelId: string } | null;
}

export interface OpenPrDeps {
  openExternal: (url: string) => Promise<void>;
  runGh?: (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
  getOriginRemote?: (cwd: string) => Promise<string | null>;
}

function buildPrompt(
  diff: string,
  recent: ReadonlyArray<{ role: string; content: string }>,
): Message[] {
  const redacted = redactSecrets(diff);
  const truncatedDiff =
    redacted.length > DIFF_TRUNCATE_CHARS
      ? `${redacted.slice(0, DIFF_TRUNCATE_CHARS)}\n... [truncated]`
      : redacted;
  const recentBlock = recent
    .map((m) => `### ${m.role}\n${m.content}`)
    .join('\n\n')
    .slice(0, 6_000);

  const system: Message = {
    role: 'system',
    content:
      'You draft pull request descriptions. Return strictly two markdown sections: "## Title" (single line) and "## Body" (a concise PR description with sections: Summary, Changes, Testing). No preamble.',
  };
  const user: Message = {
    role: 'user',
    content: `Recent conversation context:\n\n${recentBlock || '(no prior messages)'}\n\nGit diff against base:\n\n\`\`\`diff\n${truncatedDiff}\n\`\`\`\n\nDraft the PR.`,
  };
  return [system, user];
}

function parseDraft(raw: string): { title: string; body: string } {
  const titleMatch = raw.match(/##\s*Title\s*\n+([^\n]+)/i);
  const bodyMatch = raw.match(/##\s*Body\s*\n+([\s\S]*)/i);
  const title = (titleMatch?.[1] ?? '').trim() || 'Draft PR';
  const body = (bodyMatch?.[1] ?? raw).trim();
  return { title, body };
}

async function defaultGetOriginRemote(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], {
      cwd,
      windowsHide: true,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function defaultRunGh(
  cwd: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('gh', [...args], {
    cwd,
    windowsHide: true,
  });
  return { stdout, stderr };
}

export async function draftPr(
  req: GitDraftPrRequest,
  deps: DraftPrDeps,
): Promise<GitDraftPrResponse> {
  const recent = req.conversationId
    ? deps.fetchRecentMessages(
        req.conversationId,
        req.recentMessageCount ?? DEFAULT_RECENT_MESSAGES,
      )
    : [];
  const defaults = deps.resolveDefaultProvider();
  const providerId = req.providerId ?? defaults?.providerId;
  const modelId = req.modelId ?? defaults?.modelId;
  if (!providerId || !modelId) {
    return { ok: false, error: 'no provider/model available to draft PR' };
  }
  let diff = req.diff ?? '';
  if (!diff && deps.fetchDiff) {
    try {
      diff = await deps.fetchDiff(req.repoRoot, req.branch, req.baseBranch ?? 'HEAD');
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `failed to read diff: ${m}` };
    }
  }
  try {
    const provider = await deps.buildProvider(providerId);
    const messages = buildPrompt(diff, recent);
    const collected: string[] = [];
    const stream = provider.chat({ model: modelId, messages });
    for await (const event of stream as AsyncIterable<ChatEvent>) {
      if (event.type === 'text_delta') collected.push(event.delta);
      else if (event.type === 'error') {
        return { ok: false, error: event.message };
      } else if (event.type === 'done') break;
    }
    const { title, body } = parseDraft(collected.join(''));
    return { ok: true, title, body };
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
    logger.warn({ err: message }, 'draftPr failed');
    return { ok: false, error: message };
  }
}

export function deriveWebPrUrlFromRemote(
  remote: string,
  branch: string,
  baseBranch?: string,
): string | null {
  const trimmed = remote.replace(/\.git$/i, '');
  const httpsMatch = trimmed.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/);
  const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  let host: string | null = null;
  let path: string | null = null;
  if (httpsMatch) {
    host = httpsMatch[1] ?? null;
    path = httpsMatch[2] ?? null;
  } else if (sshMatch) {
    host = sshMatch[1] ?? null;
    path = sshMatch[2] ?? null;
  }
  if (!host || !path) return null;
  const lowerHost = host.toLowerCase();
  if (lowerHost === 'github.com' || lowerHost.endsWith('.github.com')) {
    const base = baseBranch ?? 'main';
    return `https://${host}/${path}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1`;
  }
  if (lowerHost === 'gitlab.com' || lowerHost.endsWith('.gitlab.com')) {
    return `https://${host}/${path}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(branch)}`;
  }
  if (lowerHost === 'bitbucket.org' || lowerHost.endsWith('.bitbucket.org')) {
    return `https://${host}/${path}/pull-requests/new?source=${encodeURIComponent(branch)}`;
  }
  return null;
}

export async function openPrInBrowser(
  req: GitOpenPrInBrowserRequest,
  deps: OpenPrDeps,
): Promise<GitOpenPrInBrowserResponse> {
  const runGh = deps.runGh ?? defaultRunGh;
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'opencodex-pr-'));
  const bodyFile = path.join(tmpDir, 'pr-body.md');
  try {
    await writeFile(bodyFile, req.body, 'utf8');
    try {
      const args = [
        'pr',
        'create',
        '--web',
        '--title',
        req.title,
        '--body-file',
        bodyFile,
        '--head',
        req.branch,
      ];
      if (req.baseBranch) args.push('--base', req.baseBranch);
      await runGh(req.repoRoot, args);
      return { ok: true, via: 'gh' };
    } catch (ghErr) {
      const getOrigin = deps.getOriginRemote ?? defaultGetOriginRemote;
      const remote = await getOrigin(req.repoRoot);
      if (!remote) {
        const msg = redactSecrets(ghErr instanceof Error ? ghErr.message : String(ghErr));
        return { ok: false, error: `gh failed and no origin remote: ${msg}` };
      }
      const url = deriveWebPrUrlFromRemote(remote, req.branch, req.baseBranch);
      if (!url) {
        return { ok: false, error: `unsupported remote host: ${remote}` };
      }
      await deps.openExternal(url);
      return { ok: true, via: 'fallback', url };
    }
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}
