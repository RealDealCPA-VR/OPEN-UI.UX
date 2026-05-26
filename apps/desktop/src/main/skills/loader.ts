import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import { app } from 'electron';
import matter from 'gray-matter';
import { logger } from '../logger';
import { getSettings } from '../storage/settings';
import { skillFrontmatterSchema, type Skill, type SkillScope } from '../../shared/skills';

const SKILL_FILE_NAME = 'SKILL.md';
const DISABLED_MARKER = '.disabled';

export interface SkillRoots {
  userRoot: string;
  projectRoot: string | null;
}

export function resolveSkillRoots(): SkillRoots {
  let userRoot: string;
  try {
    userRoot = join(app.getPath('home'), '.opencodex', 'skills');
  } catch {
    userRoot = join(
      process.env['HOME'] ?? process.env['USERPROFILE'] ?? '.',
      '.opencodex',
      'skills',
    );
  }
  const activeWorkspace = safeActiveWorkspace();
  const projectRoot = activeWorkspace ? join(activeWorkspace, '.opencodex', 'skills') : null;
  return { userRoot, projectRoot };
}

function safeActiveWorkspace(): string | null {
  try {
    return getSettings().activeWorkspace;
  } catch {
    return null;
  }
}

/**
 * Refuse names with traversal components or null bytes. Skills are sourced
 * from user files — defense in depth even though we already restrict to
 * subdirectories of the well-known roots.
 */
function isSafeSkillName(name: string): boolean {
  if (!name || name.length === 0) return false;
  if (name.includes('\0')) return false;
  if (name.includes('..')) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  return true;
}

/**
 * Verify a resolved skill directory lives under its declared root. Refuses
 * any path that uses `..` to escape the root, even via symlinks (we don't
 * realpath here — the loader treats the root as the trust boundary).
 */
function isUnderRoot(root: string, candidate: string): boolean {
  const normRoot = normalize(root);
  const normCand = normalize(candidate);
  const rel = relative(normRoot, normCand);
  if (rel === '') return false;
  if (rel.startsWith('..') || isAbsolute(rel)) return false;
  if (rel.split(sep).some((part) => part === '..')) return false;
  return true;
}

function readSkillFromDir(scope: SkillScope, root: string, dirName: string): Skill | null {
  if (!isSafeSkillName(dirName)) {
    logger.warn({ dirName }, 'skill loader: rejected unsafe directory name');
    return null;
  }
  const skillDir = join(root, dirName);
  if (!isUnderRoot(root, skillDir)) {
    logger.warn({ dirName, root }, 'skill loader: rejected directory outside root');
    return null;
  }
  const skillFile = join(skillDir, SKILL_FILE_NAME);
  if (!existsSync(skillFile)) return null;
  if (!isUnderRoot(skillDir, skillFile)) {
    logger.warn({ skillFile }, 'skill loader: SKILL.md escapes its skill directory');
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(skillFile, 'utf8');
  } catch (err) {
    logger.warn({ err, skillFile }, 'skill loader: failed to read SKILL.md');
    return null;
  }
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(raw);
  } catch (err) {
    logger.warn({ err, skillFile }, 'skill loader: failed to parse frontmatter');
    return null;
  }
  const frontmatterResult = skillFrontmatterSchema.safeParse(parsed.data);
  if (!frontmatterResult.success) {
    logger.warn(
      { skillFile, issues: frontmatterResult.error.issues },
      'skill loader: frontmatter validation failed',
    );
    return null;
  }
  const frontmatter = frontmatterResult.data;
  // The directory name and frontmatter name must agree to avoid surprising
  // routing when two skills both claim the same name.
  if (frontmatter.name !== dirName) {
    logger.warn(
      { dirName, frontmatterName: frontmatter.name },
      'skill loader: frontmatter `name` must match the directory name',
    );
    return null;
  }
  const disabled = existsSync(join(skillDir, DISABLED_MARKER));
  const id = `${scope}:${frontmatter.name}`;
  return {
    id,
    name: frontmatter.name,
    scope,
    description: frontmatter.description,
    frontmatter,
    body: parsed.content,
    sourcePath: skillFile,
    disabled,
  };
}

function safeListDir(root: string): string[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (err) {
    logger.warn({ err, root }, 'skill loader: failed to list root');
    return [];
  }
}

export function loadSkillsFromRoot(scope: SkillScope, root: string): Skill[] {
  const dirNames = safeListDir(root);
  const out: Skill[] = [];
  for (const name of dirNames) {
    const skill = readSkillFromDir(scope, root, name);
    if (skill) out.push(skill);
  }
  return out;
}

export interface LoadAllSkillsResult {
  skills: Skill[];
  roots: SkillRoots;
}

export function loadAllSkills(): LoadAllSkillsResult {
  const roots = resolveSkillRoots();
  const userSkills = loadSkillsFromRoot('user', roots.userRoot);
  const projectSkills = roots.projectRoot ? loadSkillsFromRoot('project', roots.projectRoot) : [];
  return { skills: [...userSkills, ...projectSkills], roots };
}

export function pathStatsExist(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

export { SKILL_FILE_NAME, DISABLED_MARKER };
