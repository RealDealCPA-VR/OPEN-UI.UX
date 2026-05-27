import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { logger } from '../logger';
import { getSelectedModel } from '../storage/settings';
import { getSettings } from '../storage/settings';
import {
  createTask as schedulerCreateTask,
  deleteTask as schedulerDeleteTask,
  findTaskByLinkedSkill,
  listTasksLinkedToSkills,
  updateTask as schedulerUpdateTask,
} from '../scheduler/store';
import { rescheduleNow, validateCronExpression } from '../scheduler/scheduler';
import { DISABLED_MARKER, SKILL_FILE_NAME, loadAllSkills, type SkillRoots } from './loader';
import type { Skill } from '../../shared/skills';
import { SkillsWatcher } from './watcher';

let cachedSkills: Skill[] = [];
let cachedRoots: SkillRoots | null = null;
let watcher: SkillsWatcher | null = null;
const changeListeners = new Set<(skills: Skill[]) => void>();

export interface ReloadResult {
  skills: Skill[];
  roots: SkillRoots;
}

export function getSkills(): Skill[] {
  return cachedSkills;
}

export function getRoots(): SkillRoots | null {
  return cachedRoots;
}

export function getSkillById(id: string): Skill | null {
  return cachedSkills.find((s) => s.id === id) ?? null;
}

export function onSkillsChanged(listener: (skills: Skill[]) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function emitChanged(): void {
  for (const l of changeListeners) {
    try {
      l(cachedSkills);
    } catch (err) {
      logger.warn({ err }, 'skills: change listener threw');
    }
  }
}

export async function reloadSkills(): Promise<ReloadResult> {
  const { skills, roots } = loadAllSkills();
  cachedSkills = skills;
  cachedRoots = roots;
  try {
    syncLinkedScheduledTasks(skills);
  } catch (err) {
    logger.warn({ err }, 'skills: scheduler sync failed');
  }
  emitChanged();
  return { skills, roots };
}

/**
 * Reconcile scheduler-side state with the canonical skill list. For any skill
 * with a `cron:` frontmatter we upsert a scheduled task whose linked_skill_id
 * equals the skill id and whose name is `skill:<name>`. Any task linked to a
 * skill that no longer exists (or whose skill dropped its `cron:` field) is
 * removed. We swallow errors here — a malformed cron in one skill should not
 * prevent the rest from loading.
 */
export function syncLinkedScheduledTasks(skills: ReadonlyArray<Skill>): void {
  const linkedNow = listTasksLinkedToSkills();
  const desiredById = new Map<string, Skill>();
  for (const s of skills) {
    if (s.disabled) continue;
    if (!s.frontmatter.cron) continue;
    desiredById.set(s.id, s);
  }

  for (const existing of linkedNow) {
    if (existing.linkedSkillId && !desiredById.has(existing.linkedSkillId)) {
      try {
        schedulerDeleteTask(existing.id);
      } catch (err) {
        logger.warn(
          { err, taskId: existing.id, linkedSkillId: existing.linkedSkillId },
          'skills: failed to remove stale linked scheduled task',
        );
      }
    }
  }

  for (const skill of desiredById.values()) {
    const cronExpr = skill.frontmatter.cron;
    if (!cronExpr) continue;
    try {
      validateCronExpression(cronExpr);
    } catch (err) {
      logger.warn(
        { err, skillId: skill.id, cron: cronExpr },
        'skills: invalid cron expression — skipping auto-register',
      );
      continue;
    }
    const existing = findTaskByLinkedSkill(skill.id);
    const workspacePath = (() => {
      try {
        return getSettings().activeWorkspace ?? '';
      } catch {
        return '';
      }
    })();
    if (!workspacePath) {
      logger.info(
        { skillId: skill.id },
        'skills: cron: requires an active workspace; not registering yet',
      );
      continue;
    }
    const selected = (() => {
      try {
        return getSelectedModel();
      } catch {
        return null;
      }
    })();
    if (!selected) {
      logger.info({ skillId: skill.id }, 'skills: cron: no selected model; not registering yet');
      continue;
    }
    const name = `skill:${skill.name}`;
    if (existing) {
      try {
        schedulerUpdateTask({
          id: existing.id,
          name,
          description: skill.description,
          trigger: { type: 'cron', expr: cronExpr },
          prompt: skill.body,
          ...(skill.frontmatter.tools ? { allowedTools: skill.frontmatter.tools } : {}),
        });
      } catch (err) {
        logger.warn(
          { err, skillId: skill.id, taskId: existing.id },
          'skills: failed to update linked scheduled task',
        );
      }
    } else {
      try {
        schedulerCreateTask({
          name,
          description: skill.description,
          trigger: { type: 'cron', expr: cronExpr },
          prompt: skill.body,
          providerId: selected.providerId,
          model: selected.modelId,
          workspacePath,
          allowedTools: skill.frontmatter.tools ?? [],
          useWorktree: true,
          enabled: true,
          linkedSkillId: skill.id,
          ...(skill.frontmatter.runner ? { runnerId: skill.frontmatter.runner } : {}),
        });
      } catch (err) {
        logger.warn({ err, skillId: skill.id }, 'skills: failed to create linked scheduled task');
      }
    }
  }
  try {
    rescheduleNow();
  } catch {
    // scheduler may not be running in dev — ignore
  }
}

export async function startSkills(): Promise<void> {
  await reloadSkills();
  const roots = cachedRoots;
  if (!roots) return;
  try {
    ensureRootExists(roots.userRoot);
    if (roots.projectRoot) ensureRootExists(roots.projectRoot);
  } catch (err) {
    logger.warn({ err }, 'skills: failed to ensure skill root dirs');
  }
  const watchRoots = [roots.userRoot];
  if (roots.projectRoot) watchRoots.push(roots.projectRoot);
  watcher = new SkillsWatcher({
    onChange: () => {
      void reloadSkills().catch((err) => logger.warn({ err }, 'skills: reload failed'));
    },
  });
  try {
    await watcher.start(watchRoots);
  } catch (err) {
    logger.warn({ err }, 'skills: watcher start failed');
  }
}

export async function stopSkills(): Promise<void> {
  if (watcher) {
    const w = watcher;
    watcher = null;
    await w.stop();
  }
  changeListeners.clear();
  cachedSkills = [];
  cachedRoots = null;
}

function ensureRootExists(path: string): void {
  if (existsSync(path)) return;
  mkdirSync(path, { recursive: true });
}

export async function setSkillEnabled(id: string, enabled: boolean): Promise<Skill[]> {
  const skill = getSkillById(id);
  if (!skill) throw new Error(`unknown skill: ${id}`);
  const marker = join(dirname(skill.sourcePath), DISABLED_MARKER);
  if (enabled) {
    if (existsSync(marker)) rmSync(marker, { force: true });
  } else {
    writeFileSync(marker, '');
  }
  const { skills } = await reloadSkills();
  return skills;
}

export interface CreateFromTemplateOptions {
  name: string;
  scope: 'user' | 'project';
}

export async function createSkillFromTemplate(opts: CreateFromTemplateOptions): Promise<Skill[]> {
  if (!cachedRoots) await reloadSkills();
  if (!cachedRoots) throw new Error('skill roots unavailable');
  const root = opts.scope === 'user' ? cachedRoots.userRoot : cachedRoots.projectRoot;
  if (!root) throw new Error('no project workspace selected; cannot create project skill');
  validateSkillName(opts.name);
  const dir = join(root, opts.name);
  if (existsSync(dir)) throw new Error(`skill already exists: ${opts.name}`);
  ensureRootExists(root);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, SKILL_FILE_NAME);
  writeFileSync(file, buildSkillTemplate(opts.name), 'utf8');
  const { skills } = await reloadSkills();
  return skills;
}

export interface ImportFromUrlOptions {
  url: string;
}

/**
 * Download a SKILL.md from a public https URL. Refuses non-https, oversized
 * responses, and anything that does not parse as valid skill frontmatter.
 * The caller is expected to have prompted the user with a consent dialog.
 */
export async function importSkillFromUrl(opts: ImportFromUrlOptions): Promise<Skill[]> {
  const url = String(opts.url ?? '');
  if (!/^https:\/\//i.test(url)) throw new Error('skills can only be imported over https');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('invalid URL');
  }
  if (parsed.protocol !== 'https:') throw new Error('only https URLs are allowed');
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching skill`);
  const body = await res.text();
  if (body.length > 1024 * 256) throw new Error('skill body too large (>256KB)');
  const { default: matter } = await import('gray-matter');
  let parsedMatter: ReturnType<typeof matter>;
  try {
    parsedMatter = matter(body);
  } catch (err) {
    throw new Error(
      `failed to parse downloaded skill: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const { skillFrontmatterSchema } = await import('../../shared/skills');
  const fm = skillFrontmatterSchema.safeParse(parsedMatter.data);
  if (!fm.success) {
    throw new Error(`downloaded skill has invalid frontmatter: ${fm.error.message}`);
  }
  if (!cachedRoots) await reloadSkills();
  if (!cachedRoots) throw new Error('skill roots unavailable');
  validateSkillName(fm.data.name);
  const dir = join(cachedRoots.userRoot, fm.data.name);
  if (existsSync(dir)) throw new Error(`skill already exists: ${fm.data.name}`);
  ensureRootExists(cachedRoots.userRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, SKILL_FILE_NAME), body, 'utf8');
  const { skills } = await reloadSkills();
  return skills;
}

function buildSkillTemplate(name: string): string {
  return `---
name: ${name}
description: Short description of what this skill does.
triggers:
  - keyword
arguments:
  - name: topic
    description: What to focus on
    required: true
---

You are helping with **{{topic}}** in workspace \`{{workspace}}\` on {{date}}.

Replace this body with the prompt you want the agent to follow when the user
invokes \`/skill:${name}\`. Use \`{{arg_name}}\` to substitute invocation args
and the built-in \`{{workspace}}\`, \`{{date}}\`, \`{{git_branch}}\` vars.
`;
}

const SKILL_NAME_RE = /^[a-z][a-z0-9-]*$/;

function validateSkillName(name: string): void {
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error('skill name must be kebab-case (lowercase letters, digits, dashes)');
  }
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error('skill name contains illegal characters');
  }
}

/**
 * Resolve a skill body for invocation: substitute args + built-in vars and
 * return the final text. Wrap of the pure helper so callers don't need to
 * touch the helper module directly.
 */
export async function resolveSkillBody(
  skill: Skill,
  args: Record<string, string>,
  context: { workspace: string },
): Promise<{ text: string; unknownTokens: string[] }> {
  const { substitute, isoDate } = await import('./substitute');
  const gitBranch = await safeReadGitBranch(context.workspace);
  return substitute(skill.body, {
    args,
    workspace: context.workspace,
    date: isoDate(),
    gitBranch,
  });
}

async function safeReadGitBranch(workspace: string): Promise<string> {
  if (!workspace) return '';
  try {
    const head = join(workspace, '.git', 'HEAD');
    if (!existsSync(head)) return '';
    const raw = readFileSync(head, 'utf8').trim();
    if (raw.startsWith('ref: refs/heads/')) return raw.slice('ref: refs/heads/'.length);
    return raw.slice(0, 7); // detached HEAD: short SHA
  } catch {
    return '';
  }
}
