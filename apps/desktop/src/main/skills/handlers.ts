import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, shell } from 'electron';
import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { logger } from '../logger';
import {
  createSkillFromTemplate,
  getRoots,
  getSkillById,
  getSkills,
  importSkillFromUrl,
  onSkillsChanged,
  reloadSkills,
  setSkillEnabled,
} from './manager';
import { SKILL_FILE_NAME } from './loader';
import { getSkillRegistryUrl, setSkillRegistryUrl } from '../storage/settings';
import { skillRegistrySchema, type SkillRegistryEntry } from '../../shared/skills';

const setEnabledSchema = z.object({ id: z.string().min(1), enabled: z.boolean() });
const createFromTemplateSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, 'kebab-case'),
  scope: z.enum(['user', 'project']).optional(),
});
const importFromUrlSchema = z.object({
  url: z.string().min(1),
});
const openInEditorSchema = z.object({ id: z.string().min(1) });
const installStarterSchema = z.object({ names: z.array(z.string()).optional() });

function broadcastChanged(): void {
  const skills = getSkills();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('skills:changed', { skills });
  }
}

let unsubChange: (() => void) | null = null;

export function registerSkillHandlers(): void {
  if (unsubChange) unsubChange();
  unsubChange = onSkillsChanged(() => broadcastChanged());

  registerInvoke('skills:list', z.void(), () => ({ skills: getSkills() }));

  registerInvoke('skills:reload', z.void(), async () => {
    const { skills } = await reloadSkills();
    return { skills };
  });

  registerInvoke('skills:create-from-template', createFromTemplateSchema, async (req) => {
    const skills = await createSkillFromTemplate({
      name: req.name,
      scope: req.scope ?? 'user',
    });
    return { skills };
  });

  registerInvoke('skills:import-from-url', importFromUrlSchema, async (req) => {
    const skills = await importSkillFromUrl({ url: req.url });
    return { skills };
  });

  registerInvoke('skills:set-enabled', setEnabledSchema, async (req) => {
    const skills = await setSkillEnabled(req.id, req.enabled);
    return { skills };
  });

  registerInvoke('skills:open-in-editor', openInEditorSchema, async (req) => {
    const skill = getSkillById(req.id);
    if (!skill) return { ok: false, error: `unknown skill: ${req.id}` };
    try {
      const result = await shell.openPath(skill.sourcePath);
      if (result) return { ok: false, error: result };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  registerInvoke('skills:get-registry-url', z.void(), () => ({ url: getSkillRegistryUrl() }));

  registerInvoke(
    'skills:set-registry-url',
    z.object({ url: z.string().url().nullable() }),
    (req) => ({ url: setSkillRegistryUrl(req.url) }),
  );

  registerInvoke('skills:fetch-registry', z.void(), async () => {
    const url = getSkillRegistryUrl();
    if (!url) {
      return { entries: [] as SkillRegistryEntry[], error: 'no registry URL configured' };
    }
    try {
      const response = await fetch(url, {
        // Allow up to ~10s for the registry server to respond. Network failures
        // surface as `error`; the renderer shows the message inline.
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        return { entries: [] as SkillRegistryEntry[], error: `HTTP ${response.status}` };
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('json')) {
        return {
          entries: [] as SkillRegistryEntry[],
          error: `unexpected content-type: ${contentType || 'unknown'}`,
        };
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch (err) {
        return {
          entries: [] as SkillRegistryEntry[],
          error: `malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      // The registry may be either an array of entries or `{ entries: [...] }`.
      const candidate = Array.isArray(raw) ? raw : (raw as { entries?: unknown })?.entries;
      const parsed = skillRegistrySchema.safeParse(candidate);
      if (!parsed.success) {
        return {
          entries: [] as SkillRegistryEntry[],
          error: `schema mismatch: ${parsed.error.issues[0]?.message ?? 'invalid registry shape'}`,
        };
      }
      return { entries: parsed.data, error: null };
    } catch (err) {
      return {
        entries: [] as SkillRegistryEntry[],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  registerInvoke('skills:install-starter-pack', installStarterSchema, async (req) => {
    const roots = getRoots();
    if (!roots) {
      return { skills: getSkills() };
    }
    const sourceRoot = resolveStarterSkillSource();
    if (!sourceRoot || !existsSync(sourceRoot)) {
      logger.info({ sourceRoot }, 'skills: starter pack source not found; skipping');
      return { skills: getSkills() };
    }
    const available = readdirSync(sourceRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const desired =
      req.names && req.names.length > 0
        ? available.filter((n) => req.names!.includes(n))
        : available;
    if (!existsSync(roots.userRoot)) mkdirSync(roots.userRoot, { recursive: true });
    for (const name of desired) {
      const src = join(sourceRoot, name, SKILL_FILE_NAME);
      const dstDir = join(roots.userRoot, name);
      if (existsSync(dstDir)) continue;
      if (!existsSync(src)) continue;
      mkdirSync(dstDir, { recursive: true });
      try {
        copyFileSync(src, join(dstDir, SKILL_FILE_NAME));
      } catch (err) {
        logger.warn({ err, src }, 'skills: failed to copy starter skill');
      }
    }
    const { skills } = await reloadSkills();
    return { skills };
  });
}

function resolveStarterSkillSource(): string | null {
  // In dev, examples/skills sits at the repo root. In packaged builds, it
  // is shipped under `resources/examples/skills`. We try a handful of
  // candidate roots and use whichever resolves.
  const candidates: string[] = [];
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(resolve(here, '..', '..', '..', '..', '..', 'examples', 'skills'));
    candidates.push(resolve(here, '..', '..', '..', '..', 'examples', 'skills'));
    candidates.push(resolve(here, '..', '..', '..', 'examples', 'skills'));
  } catch {
    // import.meta.url not available — fall through
  }
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'examples', 'skills'));
  }
  if (process.cwd()) {
    candidates.push(join(process.cwd(), 'examples', 'skills'));
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}
