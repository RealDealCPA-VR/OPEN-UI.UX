#!/usr/bin/env node
// OpenCodex health probe.
//
// Runs ~15 probes that catch about 80% of "the app won't start" / "database
// empty" / "binary missing" / "key not configured" / "MCP server not installed"
// cases WITHOUT launching Electron (the app may be the thing broken).
//
// Output:
//   stdout — JSON: { probes: { <name>: { ok, durationMs, detail } }, summary }
//   stderr — human-readable: traffic light per probe, no emojis (bare ASCII)
//
// Exit code:
//   0 — all OK
//   1 — at least one warn
//   2 — at least one fail

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
// apps/desktop owns the better-sqlite3 + keytar deps. Spawn children with
// cwd set there so `require('better-sqlite3')` resolves.
const DESKTOP_CWD = join(SELF, '..', '..');
const ARGS = process.argv.slice(2);

if (ARGS.includes('--help') || ARGS.includes('-h')) {
  process.stdout.write(
    [
      'pnpm diagnose — OpenCodex health probe',
      '',
      'Runs probes without launching Electron and writes a JSON blob to stdout',
      'plus a human-readable summary to stderr.',
      '',
      'Usage:',
      '  pnpm diagnose            run all probes',
      '  pnpm diagnose --help     show this message',
      '',
      'Exit codes: 0 (all OK), 1 (warn), 2 (fail)',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

// ---------- userData path resolution (no Electron) ----------
// Mirrors `app.getPath('userData')` on each platform. The product name is
// pulled from apps/desktop/package.json so a rename stays in sync.

function readProductName() {
  try {
    const here = SELF.replaceAll('\\', '/');
    const desktopRoot = here.split('/scripts/')[0];
    const pkg = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'));
    return pkg.productName ?? pkg.name ?? 'opencodex';
  } catch {
    return 'opencodex';
  }
}

function resolveUserDataDir() {
  const name = readProductName();
  if (process.env.OPENCODEX_USERDATA) return process.env.OPENCODEX_USERDATA;
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', name);
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), name);
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), name);
  }
}

const USER_DATA = resolveUserDataDir();

// ---------- helpers ----------

function safeKeyDigest(value) {
  if (typeof value !== 'string' || value.length === 0) return '(empty)';
  const trimmed = value.trim();
  const suffix = trimmed.length > 3 ? trimmed.slice(-3) : trimmed;
  return `(len=${trimmed.length}, …${suffix})`;
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

async function runProbe(name, fn) {
  const start = Date.now();
  try {
    const result = await Promise.resolve(fn());
    return {
      ok: result?.ok ?? true,
      warn: result?.warn === true,
      durationMs: Date.now() - start,
      detail: result?.detail ?? result ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      warn: false,
      durationMs: Date.now() - start,
      detail: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

// ---------- probes ----------

function probeNodeAndPnpm() {
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split('.')[0]);
  const okNode = major >= 20;
  let pnpmVersion = null;
  try {
    const r = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--version'], {
      timeout: 3000,
      encoding: 'utf8',
    });
    pnpmVersion = r.stdout?.trim() || null;
  } catch {
    /* */
  }
  const pnpmMajor = pnpmVersion ? Number(pnpmVersion.split('.')[0]) : null;
  const okPnpm = pnpmMajor !== null && pnpmMajor >= 9;
  return {
    ok: okNode && okPnpm,
    warn: okNode && !okPnpm,
    detail: { nodeVersion, pnpmVersion, requiredNode: '>=20', requiredPnpm: '>=9' },
  };
}

function probeBetterSqliteAbi() {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '-e',

        "try { const m = require('better-sqlite3'); const db = new m(':memory:'); db.exec('SELECT 1'); db.close(); process.stdout.write(JSON.stringify({ ok: true })); } catch (e) { process.stdout.write(JSON.stringify({ ok: false, message: String(e.message), code: e.code ?? null })); }",
      ],
      { timeout: 8000, cwd: join(SELF, '..', '..') },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => {
      out += b.toString();
    });
    child.stderr.on('data', (b) => {
      err += b.toString();
    });
    child.on('close', () => {
      let parsed = null;
      try {
        parsed = JSON.parse(out);
      } catch {
        parsed = { ok: false, message: err || out || 'spawn failed' };
      }
      const abiMismatch =
        parsed.message &&
        (parsed.message.includes('NODE_MODULE_VERSION') ||
          parsed.message.includes('ERR_DLOPEN_FAILED'));
      resolve({
        ok: parsed.ok === true,
        detail: {
          loaded: parsed.ok === true,
          abiMismatch: !!abiMismatch,
          nodeModuleVersion: process.versions.modules,
          message: parsed.message ?? null,
          hint: abiMismatch
            ? 'Run `pnpm rebuild-native` from apps/desktop, then re-run diagnose.'
            : null,
        },
      });
    });
    child.on('error', (e) =>
      resolve({ ok: false, detail: { loaded: false, message: String(e.message) } }),
    );
  });
}

async function probeSqliteDatabase() {
  const dbPath = join(USER_DATA, 'opencodex.db');
  if (!existsSync(dbPath)) {
    return {
      ok: true,
      warn: true,
      detail: { exists: false, path: dbPath, hint: 'App has not launched yet.' },
    };
  }
  // Open in a child to avoid pulling better-sqlite3 into this process if ABI is wrong.
  const code = `
    const Database = require('better-sqlite3');
    const db = new Database(${JSON.stringify(dbPath)}, { readonly: true, fileMustExist: true });
    function safeCount(table) {
      try { return db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n; } catch { return null; }
    }
    const out = {
      schema_version: db.pragma('schema_version', { simple: true }),
      integrity: db.pragma('integrity_check', { simple: true }),
      conversations: safeCount('conversations'),
      messages: safeCount('messages'),
      tool_calls: safeCount('tool_calls'),
      scheduled_tasks: safeCount('scheduled_tasks'),
      agent_runs_persistent: safeCount('agent_runs_persistent'),
    };
    db.close();
    process.stdout.write(JSON.stringify(out));
  `;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', code], {
      timeout: 8000,
      cwd: DESKTOP_CWD,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => {
      out += b.toString();
    });
    child.stderr.on('data', (b) => {
      err += b.toString();
    });
    child.on('close', () => {
      try {
        const parsed = JSON.parse(out);
        const wal = existsSync(`${dbPath}-wal`);
        const ok = parsed.integrity === 'ok';
        resolve({
          ok,
          detail: { path: dbPath, wal, ...parsed },
        });
      } catch {
        resolve({ ok: false, detail: { path: dbPath, error: err || out || 'unknown' } });
      }
    });
  });
}

function probeSettingsStore() {
  const path = join(USER_DATA, 'settings.json');
  if (!existsSync(path)) {
    return {
      ok: true,
      warn: true,
      detail: { exists: false, path, hint: 'App has not launched yet.' },
    };
  }
  const json = readJsonSafe(path);
  if (!json) {
    return { ok: false, detail: { path, error: 'parse failed' } };
  }
  const providerIds = json.providers ? Object.keys(json.providers) : [];
  const keysPresent = {};
  for (const id of providerIds) {
    const entry = json.providers[id] ?? {};
    // We never echo values; record only key presence + a length hint if the
    // field looks like a token (settings.json should not carry secrets, but
    // we redact regardless to be safe).
    keysPresent[id] = Object.keys(entry).filter((k) => entry[k] !== null && entry[k] !== undefined);
  }
  return {
    ok: true,
    detail: {
      path,
      providerIds,
      providerFieldsPresent: keysPresent,
      selectedModels: json.selectedModels ? Object.keys(json.selectedModels) : [],
      schedulerEnabledInDev: json.schedulerEnabledInDev === true,
      antiSycophancyEnabled: json.antiSycophancyEnabled !== false,
    },
  };
}

async function probeKeychain() {
  try {
    const require = createRequire(SELF);
    const keytar = require('keytar');
    const creds = await keytar.findCredentials('opencodex');
    const accounts = creds.map((c) => c.account);
    return {
      ok: true,
      detail: {
        count: creds.length,
        accounts,
        sample: creds[0]
          ? { account: creds[0].account, password: safeKeyDigest(creds[0].password) }
          : null,
      },
    };
  } catch (err) {
    return {
      ok: true,
      warn: true,
      detail: {
        loaded: false,
        hint: 'keytar not available in this process',
        error: String(err.message),
      },
    };
  }
}

function probeWorkspace() {
  const settings = readJsonSafe(join(USER_DATA, 'settings.json'));
  const activeWorkspace =
    settings?.activeWorkspace ?? settings?.workspace ?? settings?.workspaceRoot ?? null;
  if (!activeWorkspace) {
    return {
      ok: true,
      warn: true,
      detail: { hint: 'No activeWorkspace recorded (likely first-run).' },
    };
  }
  let exists = false;
  let isDir = false;
  try {
    const st = statSync(activeWorkspace);
    exists = true;
    isDir = st.isDirectory();
  } catch {
    /* */
  }
  return {
    ok: exists && isDir,
    detail: { activeWorkspace, exists, isDir },
  };
}

function probeMcpServers() {
  // MCP config is persisted in the SQLite DB, not a JSON file. The probe here
  // is best-effort: if the DB is present and we can open it read-only, we look
  // for an mcp_servers table; otherwise we skip with a clear message.
  const dbPath = join(USER_DATA, 'opencodex.db');
  if (!existsSync(dbPath)) {
    return { ok: true, warn: true, detail: { exists: false, hint: 'DB missing.' } };
  }
  const code = `
    const Database = require('better-sqlite3');
    const db = new Database(${JSON.stringify(dbPath)}, { readonly: true, fileMustExist: true });
    let rows = [];
    try {
      rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mcp%'").all();
    } catch (e) { /* */ }
    process.stdout.write(JSON.stringify({ tables: rows.map(r => r.name) }));
    db.close();
  `;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', code], { timeout: 5000, cwd: DESKTOP_CWD });
    let out = '';
    child.stdout.on('data', (b) => {
      out += b.toString();
    });
    child.on('close', () => {
      try {
        const parsed = JSON.parse(out);
        resolve({ ok: true, detail: parsed });
      } catch {
        resolve({ ok: true, warn: true, detail: { error: 'could not enumerate' } });
      }
    });
  });
}

function probeProviderConfig() {
  const settings = readJsonSafe(join(USER_DATA, 'settings.json'));
  if (!settings) {
    return { ok: true, warn: true, detail: { hint: 'settings.json missing.' } };
  }
  const providers = settings.providers ?? {};
  const ids = Object.keys(providers);
  return {
    ok: ids.length > 0,
    warn: ids.length === 0,
    detail: {
      providerIds: ids,
      hint: ids.length === 0 ? 'No providers configured. Open onboarding.' : null,
    },
  };
}

async function probeAuditLog() {
  const dbPath = join(USER_DATA, 'opencodex.db');
  if (!existsSync(dbPath)) {
    return { ok: true, warn: true, detail: { exists: false } };
  }
  const code = `
    const Database = require('better-sqlite3');
    const db = new Database(${JSON.stringify(dbPath)}, { readonly: true, fileMustExist: true });
    let count = null, last = null;
    try {
      count = db.prepare('SELECT COUNT(*) AS n FROM tool_calls').get().n;
      last = db.prepare('SELECT created_at FROM tool_calls ORDER BY created_at DESC LIMIT 1').get();
    } catch {}
    db.close();
    process.stdout.write(JSON.stringify({ count, last: last?.created_at ?? null }));
  `;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', code], { timeout: 5000, cwd: DESKTOP_CWD });
    let out = '';
    child.stdout.on('data', (b) => {
      out += b.toString();
    });
    child.on('close', () => {
      try {
        resolve({ ok: true, detail: JSON.parse(out) });
      } catch {
        resolve({ ok: true, warn: true, detail: { error: 'query failed' } });
      }
    });
  });
}

function probeWormMirror() {
  const settings = readJsonSafe(join(USER_DATA, 'settings.json'));
  const enabled = settings?.auditWormEnabled === true;
  const path = join(USER_DATA, 'audit-worm.ndjson');
  if (!enabled) {
    return { ok: true, detail: { enabled: false } };
  }
  const exists = existsSync(path);
  return {
    ok: exists,
    detail: {
      enabled: true,
      path,
      exists,
      hint: !exists ? 'WORM enabled but file missing — open the app to initialize.' : null,
    },
  };
}

function probeFreeDiskSpace() {
  const targets = [USER_DATA, tmpdir()];
  const settings = readJsonSafe(join(USER_DATA, 'settings.json'));
  const ws = settings?.activeWorkspace;
  if (ws) targets.push(ws);
  const out = {};
  for (const t of targets) {
    try {
      const stat = statSync(t);
      out[t] = { exists: true, isDir: stat.isDirectory() };
    } catch {
      out[t] = { exists: false };
    }
  }
  // Node has no portable statvfs without a native module; report path
  // existence and let the operator run `df` if needed.
  return {
    ok: true,
    warn: false,
    detail: { targets: out, note: 'free-space estimate omitted (no native statvfs)' },
  };
}

function probeNetworkPolicy() {
  const path = join(USER_DATA, 'privacy.json');
  if (!existsSync(path)) {
    return { ok: true, warn: true, detail: { exists: false } };
  }
  const json = readJsonSafe(path);
  if (!json) return { ok: false, detail: { error: 'parse failed (fail-closed: outbound denied)' } };
  return {
    ok: true,
    detail: {
      localOnly: json.localOnly === true,
      allowlistLength: Array.isArray(json.allowlist) ? json.allowlist.length : null,
      hint:
        Array.isArray(json.allowlist) && json.allowlist.length === 0
          ? 'Empty allowlist means "allow all" by design.'
          : null,
    },
  };
}

async function spawnWithTimeout(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const useShell = process.platform === 'win32';
    let child;
    try {
      child = spawn(cmd, args, { timeout: timeoutMs, shell: useShell, windowsHide: true });
    } catch (e) {
      resolve({ ok: false, code: -1, signal: null, stdout: '', stderr: String(e.message) });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (b) => {
      stdout += b.toString();
    });
    child.stderr?.on('data', (b) => {
      stderr += b.toString();
    });
    child.on('close', (code, signal) => {
      resolve({
        ok: code === 0,
        code,
        signal,
        stdout: stdout.slice(0, 2048),
        stderr: stderr.slice(0, 2048),
      });
    });
    child.on('error', (e) => {
      resolve({ ok: false, code: -1, signal: null, stdout: '', stderr: String(e.message) });
    });
  });
}

async function probeRunnerCli() {
  const runners = [
    { id: 'claude-code', cmd: 'claude' },
    { id: 'opencode', cmd: 'opencode' },
    { id: 'aider', cmd: 'aider' },
  ];
  const results = {};
  let anyOk = false;
  for (const r of runners) {
    const res = await spawnWithTimeout(r.cmd, ['--version'], 5000);
    results[r.id] = {
      ok: res.ok,
      code: res.code,
      hintIfMissing: res.ok ? null : `Install ${r.cmd} or set its path in Settings → Runners.`,
    };
    if (res.ok) anyOk = true;
  }
  return {
    ok: true,
    warn: !anyOk,
    detail: results,
  };
}

async function probeMcpStdioBinaries() {
  // Best-effort: enumerate distinct command names from sqlite mcp_* tables if
  // they exist. If the user has zero MCP servers, this probe is a no-op.
  const dbPath = join(USER_DATA, 'opencodex.db');
  if (!existsSync(dbPath)) return { ok: true, warn: true, detail: { exists: false } };
  const code = `
    const Database = require('better-sqlite3');
    const db = new Database(${JSON.stringify(dbPath)}, { readonly: true, fileMustExist: true });
    let servers = [];
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mcp%'").all();
      for (const t of tables) {
        try {
          const rows = db.prepare('SELECT * FROM ' + t.name + ' LIMIT 100').all();
          for (const r of rows) {
            // Heuristic: any row column whose name looks like 'command' or 'cmd'
            for (const k of Object.keys(r)) {
              if (/^(command|cmd|binary)$/i.test(k) && typeof r[k] === 'string') {
                servers.push({ table: t.name, command: r[k] });
              }
            }
          }
        } catch {}
      }
    } catch {}
    process.stdout.write(JSON.stringify(servers));
    db.close();
  `;
  const enumerated = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', code], { timeout: 5000, cwd: DESKTOP_CWD });
    let out = '';
    child.stdout.on('data', (b) => {
      out += b.toString();
    });
    child.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve([]);
      }
    });
  });
  if (!Array.isArray(enumerated) || enumerated.length === 0) {
    return { ok: true, detail: { servers: [], hint: 'No MCP servers configured.' } };
  }
  const results = [];
  for (const s of enumerated) {
    const probe = await spawnWithTimeout(s.command, ['--help'], 5000);
    results.push({ table: s.table, command: s.command, ok: probe.ok });
  }
  return {
    ok: results.every((r) => r.ok),
    warn: results.some((r) => !r.ok),
    detail: { servers: results },
  };
}

async function probeProviderHttp() {
  // Provider configs live in settings.providers; API keys live in keychain.
  // We only probe providers whose key is in the keychain — otherwise we'd
  // hit anon-rate-limited endpoints needlessly.
  const settings = readJsonSafe(join(USER_DATA, 'settings.json'));
  const providers = settings?.providers ?? {};
  let keytarMod = null;
  try {
    const require = createRequire(SELF);
    keytarMod = require('keytar');
  } catch {
    return { ok: true, warn: true, detail: { hint: 'keytar not available; skipping HTTP probe.' } };
  }
  const endpoints = {
    openai: 'https://api.openai.com/v1/models',
    anthropic: 'https://api.anthropic.com/v1/models',
    google: 'https://generativelanguage.googleapis.com/v1beta/models',
    mistral: 'https://api.mistral.ai/v1/models',
    openrouter: 'https://openrouter.ai/api/v1/models',
    xai: 'https://api.x.ai/v1/models',
    voyage: 'https://api.voyageai.com/v1/embeddings',
    ollama: null, // local, probed separately
  };
  const results = {};
  for (const id of Object.keys(providers)) {
    const url = endpoints[id];
    if (!url) {
      results[id] = { skipped: true, reason: 'no probe URL' };
      continue;
    }
    let hasKey = false;
    try {
      const pw = await keytarMod.getPassword('opencodex', id);
      hasKey = typeof pw === 'string' && pw.trim().length > 0;
    } catch {
      /* */
    }
    if (!hasKey) {
      results[id] = { skipped: true, reason: 'no key in keychain' };
      continue;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      clearTimeout(timer);
      results[id] = { ok: res.ok, status: res.status };
    } catch (err) {
      results[id] = { ok: false, error: String(err.message) };
    }
  }
  const probed = Object.values(results).filter((r) => !r.skipped);
  return {
    ok: probed.every((r) => r.ok),
    warn: probed.length === 0,
    detail: results,
  };
}

// ---------- driver ----------

const PROBES = [
  ['node-pnpm', probeNodeAndPnpm],
  ['better-sqlite3-abi', probeBetterSqliteAbi],
  ['sqlite-db', probeSqliteDatabase],
  ['settings-store', probeSettingsStore],
  ['keychain', probeKeychain],
  ['workspace', probeWorkspace],
  ['mcp-servers', probeMcpServers],
  ['provider-config', probeProviderConfig],
  ['audit-log', probeAuditLog],
  ['worm-mirror', probeWormMirror],
  ['disk-space', probeFreeDiskSpace],
  ['network-policy', probeNetworkPolicy],
  ['mcp-stdio-binaries', probeMcpStdioBinaries],
  ['runner-cli', probeRunnerCli],
  ['provider-http', probeProviderHttp],
];

function statusGlyph(result) {
  if (result.ok && !result.warn) return '✓'; // ✓
  if (result.warn) return '⚠'; // ⚠
  return '✗'; // ✗
}

async function main() {
  const probes = {};
  for (const [name, fn] of PROBES) {
    probes[name] = await runProbe(name, fn);
  }
  // Classification rules:
  //   warn ⇒ yellow regardless of ok
  //   !warn && !ok ⇒ red
  //   !warn && ok ⇒ green
  const okCount = Object.values(probes).filter((p) => p.ok && !p.warn).length;
  const warnCount = Object.values(probes).filter((p) => p.warn).length;
  const errCount = Object.values(probes).filter((p) => !p.ok && !p.warn).length;
  const summary = { okCount, warnCount, errCount, userDataDir: USER_DATA };

  // stderr: human-readable
  process.stderr.write(`\nOpenCodex diagnose — userData: ${USER_DATA}\n`);
  for (const [name, result] of Object.entries(probes)) {
    const glyph = statusGlyph(result);
    process.stderr.write(`  ${glyph}  ${name.padEnd(22)} ${result.durationMs} ms\n`);
  }
  process.stderr.write(`\n${okCount} ok, ${warnCount} warn, ${errCount} fail\n\n`);

  // stdout: JSON
  process.stdout.write(JSON.stringify({ probes, summary }, null, 2));
  process.stdout.write('\n');

  if (errCount > 0) process.exit(2);
  if (warnCount > 0) process.exit(1);
  process.exit(0);
}

// Avoid keeping the process alive on a stuck probe — every probe has its own
// timeout, but as a belt-and-suspenders measure the whole driver has a hard
// ceiling of 90s.
const HARD_CEILING_MS = 90_000;
const ceiling = setTimeout(() => {
  process.stderr.write('\ndiagnose: hard timeout exceeded\n');
  process.exit(2);
}, HARD_CEILING_MS);
ceiling.unref();

await main();
