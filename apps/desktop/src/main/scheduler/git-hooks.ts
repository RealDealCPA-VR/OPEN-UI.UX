import { createHmac, randomFillSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

/**
 * Installs lightweight wrapper scripts into `<workspace>/.git/hooks/` that POST
 * a signed JSON payload to the local scheduler listener when the hook fires.
 *
 * Hook contract:
 *   - The wrapper script is POSIX `sh` with a `.cmd` companion for Git for
 *     Windows users (`.git/hooks/<hook>.cmd`).
 *   - The body sent is `{"taskId": "<id>", "hook": "<post-commit|pre-push>"}`
 *     and the listener authenticates it with the per-task secret + HMAC-SHA256.
 *   - If a hook script already exists, our wrapper is installed under
 *     `<hook>.opencodex` and the existing hook is amended with a sourcing line
 *     guarded by a sentinel comment so removal is exact.
 *
 * Security:
 *   - We never write to anything outside `<workspace>/.git/hooks/`. The path
 *     is normalized + checked against the workspace root.
 *   - Scripts only run `curl -X POST` / `Invoke-WebRequest` against
 *     `http://127.0.0.1:<port>/trigger/<taskId>`. No `eval`, no piping.
 */

export const SENTINEL_BEGIN = '# opencodex-hook BEGIN';
export const SENTINEL_END = '# opencodex-hook END';
export const SUPPORTED_HOOKS = ['post-commit', 'pre-push'] as const;
export type GitHookName = (typeof SUPPORTED_HOOKS)[number];

/** Filename inside `<workspace>/.git/hooks/` that holds the current listener port. */
export const PORT_FILE_NAME = 'opencodex-port';

export function generateHookSecret(): string {
  // 32 hex chars = 128 bits; lowercase hex.
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);
  return Buffer.from(bytes).toString('hex');
}

export function computeBodySignature(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

interface ResolvedHookPaths {
  workspaceRoot: string;
  hookDir: string;
  primary: string;
  primaryCmd: string;
  wrapper: string;
  wrapperCmd: string;
}

function resolveHookPaths(workspaceRoot: string, hook: GitHookName): ResolvedHookPaths {
  const absWorkspace = resolve(workspaceRoot);
  const hookDir = resolve(absWorkspace, '.git', 'hooks');
  // Path-traversal guard: hookDir must be strictly inside absWorkspace.
  const rel = relative(absWorkspace, hookDir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`git-hooks: hook dir escapes workspace: ${hookDir}`);
  }
  const primary = join(hookDir, hook);
  const primaryCmd = `${primary}.cmd`;
  const wrapper = `${primary}.opencodex`;
  const wrapperCmd = `${wrapper}.cmd`;
  // Each derived path must also stay inside hookDir (defense in depth).
  for (const p of [primary, primaryCmd, wrapper, wrapperCmd]) {
    const r = relative(hookDir, normalize(p));
    if (r === '' || r.startsWith('..') || r.includes(sep)) {
      throw new Error(`git-hooks: derived hook path escapes hookDir: ${p}`);
    }
  }
  return { workspaceRoot: absWorkspace, hookDir, primary, primaryCmd, wrapper, wrapperCmd };
}

function buildShWrapper(args: {
  taskId: string;
  hook: GitHookName;
  url: string;
  secret: string;
}): string {
  const body = JSON.stringify({ taskId: args.taskId, hook: args.hook });
  const sig = computeBodySignature(body, args.secret);
  // The wrapper reads the listener port at runtime from <hooks>/opencodex-port
  // so the URL stays correct across listener restarts that pick a different
  // port. The fallback URL is the value baked at install time, in case the
  // port file is missing or unreadable.
  const fallbackUrl = args.url;
  return [
    '#!/bin/sh',
    `# Installed by OpenCodex for scheduled task ${args.taskId}`,
    SENTINEL_BEGIN,
    `TASK_ID=${shellQuote(args.taskId)}`,
    `BODY=${shellQuote(body)}`,
    `SIG=${shellQuote(sig)}`,
    `FALLBACK_URL=${shellQuote(fallbackUrl)}`,
    'HOOK_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
    `PORT_FILE="$HOOK_DIR/${PORT_FILE_NAME}"`,
    'URL="$FALLBACK_URL"',
    'if [ -r "$PORT_FILE" ]; then',
    '  PORT=$(head -n1 "$PORT_FILE" | tr -d "\\r\\n\\t ")',
    '  case "$PORT" in',
    '    ""|*[!0-9]*) : ;;',
    '    *) URL="http://127.0.0.1:$PORT/trigger/$TASK_ID" ;;',
    '  esac',
    'fi',
    'if command -v curl >/dev/null 2>&1; then',
    '  curl -sS -X POST -H "content-type: application/json" -H "x-opencodex-signature: $SIG" -d "$BODY" "$URL" >/dev/null 2>&1 || true',
    'fi',
    SENTINEL_END,
    '',
  ].join('\n');
}

function buildCmdWrapper(args: {
  taskId: string;
  hook: GitHookName;
  url: string;
  secret: string;
}): string {
  const body = JSON.stringify({ taskId: args.taskId, hook: args.hook });
  const sig = computeBodySignature(body, args.secret);
  // Windows .cmd companion. PowerShell's Invoke-WebRequest is universally
  // available; we keep it side-effect-free and silent.
  return [
    '@echo off',
    `REM Installed by OpenCodex for scheduled task ${args.taskId}`,
    SENTINEL_BEGIN.replace(/^#/, 'REM'),
    `set "TASK_ID=${args.taskId}"`,
    `set "FALLBACK_URL=${args.url}"`,
    'set "URL=%FALLBACK_URL%"',
    `set "PORT_FILE=%~dp0${PORT_FILE_NAME}"`,
    'if exist "%PORT_FILE%" (',
    '  for /f "usebackq delims=" %%P in ("%PORT_FILE%") do set "PORT=%%P"',
    '  call set "PORT=%%PORT: =%%"',
    '  if not "%PORT%"=="" set "URL=http://127.0.0.1:%PORT%/trigger/%TASK_ID%"',
    ')',
    `set "BODY=${body.replace(/"/g, '""')}"`,
    `set "SIG=${sig}"`,
    "powershell -NoProfile -Command \"try { Invoke-WebRequest -Uri $env:URL -Method POST -ContentType 'application/json' -Headers @{ 'x-opencodex-signature' = $env:SIG } -Body $env:BODY -UseBasicParsing | Out-Null } catch {}\"",
    SENTINEL_END.replace(/^#/, 'REM'),
    '',
  ].join('\r\n');
}

function shellQuote(s: string): string {
  // POSIX single-quote escape — wrap in single quotes, escape any embedded
  // single quotes by closing the quote, inserting an escaped quote, reopening.
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export interface InstallHookOptions {
  workspaceRoot: string;
  hook: GitHookName;
  taskId: string;
  url: string;
  secret: string;
}

export interface InstallHookResult {
  primaryWritten: boolean;
  wrapperWritten: boolean;
  cmdWritten: boolean;
}

/**
 * Install the hook wrapper. If `<hook>` already exists and is NOT our managed
 * hook, install our content as `<hook>.opencodex` and append a sentinel-guarded
 * sourcing line to the existing `<hook>` so both run on a single git event.
 * Idempotent: running twice writes the same content.
 */
export function installGitHook(opts: InstallHookOptions): InstallHookResult {
  const paths = resolveHookPaths(opts.workspaceRoot, opts.hook);
  if (!existsSync(join(paths.workspaceRoot, '.git'))) {
    throw new Error(`git-hooks: not a git repo (no .git dir): ${paths.workspaceRoot}`);
  }
  if (!existsSync(paths.hookDir)) {
    mkdirSync(paths.hookDir, { recursive: true });
  }
  const shBody = buildShWrapper({
    taskId: opts.taskId,
    hook: opts.hook,
    url: opts.url,
    secret: opts.secret,
  });
  const cmdBody = buildCmdWrapper({
    taskId: opts.taskId,
    hook: opts.hook,
    url: opts.url,
    secret: opts.secret,
  });

  const existing = readIfExists(paths.primary);
  let primaryWritten = false;
  let wrapperWritten = false;

  if (existing === null) {
    writeFileSync(paths.primary, shBody, { mode: 0o755 });
    primaryWritten = true;
  } else if (isOurManagedHook(existing)) {
    // Replace fully — we own this file.
    writeFileSync(paths.primary, shBody, { mode: 0o755 });
    primaryWritten = true;
  } else {
    // Coexist: write the .opencodex wrapper and append a sourcing line.
    writeFileSync(paths.wrapper, shBody, { mode: 0o755 });
    wrapperWritten = true;
    const merged = ensureSourcingAppended(existing, paths.wrapper);
    if (merged !== existing) {
      writeFileSync(paths.primary, merged, { mode: 0o755 });
      primaryWritten = true;
    }
  }

  // Always (re)write the .cmd companion. Git for Windows looks at both.
  writeFileSync(paths.primaryCmd, cmdBody);
  void paths.wrapperCmd;
  return { primaryWritten, wrapperWritten, cmdWritten: true };
}

/**
 * Persist the currently-bound scheduler-listener port into
 * `<workspace>/.git/hooks/opencodex-port`. The installed wrapper scripts read
 * this file at runtime so a listener port change (e.g. after a reboot picks a
 * different free port) doesn't require re-baking every hook.
 */
export function writeListenerPortFile(workspaceRoot: string, port: number): void {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`writeListenerPortFile: invalid port: ${port}`);
  }
  const absWorkspace = resolve(workspaceRoot);
  const hookDir = resolve(absWorkspace, '.git', 'hooks');
  const rel = relative(absWorkspace, hookDir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`writeListenerPortFile: hook dir escapes workspace: ${hookDir}`);
  }
  if (!existsSync(join(absWorkspace, '.git'))) {
    throw new Error(`writeListenerPortFile: not a git repo: ${absWorkspace}`);
  }
  if (!existsSync(hookDir)) {
    mkdirSync(hookDir, { recursive: true });
  }
  writeFileSync(join(hookDir, PORT_FILE_NAME), `${port}\n`, { mode: 0o644 });
}

export function getListenerPortFilePath(workspaceRoot: string): string {
  return resolve(workspaceRoot, '.git', 'hooks', PORT_FILE_NAME);
}

/**
 * Uninstall the hook wrapper. If we wrote the whole `<hook>` file, delete it.
 * If we appended a sourcing line to an existing user hook, strip the sentinel
 * block. The companion `.opencodex` + `.cmd` files are always removed.
 */
export function uninstallGitHook(workspaceRoot: string, hook: GitHookName): void {
  const paths = resolveHookPaths(workspaceRoot, hook);
  const existing = readIfExists(paths.primary);
  if (existing !== null) {
    if (isOurManagedHook(existing)) {
      try {
        rmSync(paths.primary);
      } catch {
        // ignore
      }
    } else {
      const stripped = stripSourcingBlock(existing);
      if (stripped !== existing) {
        if (stripped.trim().length === 0) {
          try {
            rmSync(paths.primary);
          } catch {
            // ignore
          }
        } else {
          writeFileSync(paths.primary, stripped, { mode: 0o755 });
        }
      }
    }
  }
  for (const p of [paths.wrapper, paths.wrapperCmd, paths.primaryCmd]) {
    if (existsSync(p)) {
      try {
        rmSync(p);
      } catch {
        // ignore
      }
    }
  }
}

function readIfExists(path: string): string | null {
  try {
    const st = statSync(path);
    if (!st.isFile()) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function isOurManagedHook(content: string): boolean {
  // A file is "ours" if it starts with the OpenCodex sentinel header AND the
  // body contains only one sentinel block (no foreign content surrounding it).
  const trimmed = content.trim();
  if (!trimmed.startsWith('#!/bin/sh')) return false;
  if (!trimmed.includes(SENTINEL_BEGIN)) return false;
  if (!trimmed.includes(SENTINEL_END)) return false;
  // The header comment line we emit is `# Installed by OpenCodex` — check it
  // to disambiguate from a user-authored hook that just happens to include the
  // sentinel string.
  return trimmed.includes('# Installed by OpenCodex');
}

function ensureSourcingAppended(existing: string, wrapperPath: string): string {
  if (existing.includes(SENTINEL_BEGIN) && existing.includes(SENTINEL_END)) {
    // Already appended. Idempotent.
    return existing;
  }
  const block = [
    SENTINEL_BEGIN,
    `# Sources the OpenCodex wrapper installed for a scheduled task.`,
    `# Remove this block (BEGIN→END) to detach the wrapper.`,
    `[ -x ${shellQuote(wrapperPath)} ] && ${shellQuote(wrapperPath)}`,
    SENTINEL_END,
    '',
  ].join('\n');
  const sep2 = existing.endsWith('\n') ? '' : '\n';
  return `${existing}${sep2}\n${block}`;
}

function stripSourcingBlock(existing: string): string {
  const lines = existing.split('\n');
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (!inside && line.includes(SENTINEL_BEGIN)) {
      inside = true;
      continue;
    }
    if (inside) {
      if (line.includes(SENTINEL_END)) {
        inside = false;
      }
      continue;
    }
    out.push(line);
  }
  return (
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + (existing.endsWith('\n') ? '\n' : '')
  );
}
