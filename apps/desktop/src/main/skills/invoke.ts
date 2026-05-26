import { getSkillById, getSkills, resolveSkillBody } from './manager';

/**
 * Recognize a chat message whose first line is `/skill:<name> [args...]`.
 * Returns the parsed pieces or null when the message is a regular prompt.
 */
export interface SkillInvocation {
  name: string;
  argsText: string;
  /** Full first line including the slash command, for echo back to the model. */
  firstLine: string;
}

const PREFIX_RE = /^\/skill:([a-z][a-z0-9-]*)(?:\s+(.*))?$/;

export function detectSkillInvocation(userMessage: string): SkillInvocation | null {
  const firstLineEnd = userMessage.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? userMessage : userMessage.slice(0, firstLineEnd);
  const m = PREFIX_RE.exec(firstLine.trim());
  if (!m) return null;
  const name = m[1];
  const argsText = m[2] ?? '';
  if (!name) return null;
  return { name, argsText, firstLine };
}

export interface ResolvedSkillInvocation {
  systemPrompt: string;
  allowedToolNames: string[] | null;
  unknownTokens: string[];
}

export async function resolveSkillInvocation(
  invocation: SkillInvocation,
  context: { workspace: string },
): Promise<ResolvedSkillInvocation> {
  // Prefer project scope over user scope when two skills share a name.
  const skills = getSkills();
  const candidates = skills.filter((s) => s.name === invocation.name && !s.disabled);
  const projectMatch = candidates.find((s) => s.scope === 'project');
  const skill =
    projectMatch ??
    candidates.find((s) => s.scope === 'user') ??
    getSkillById(`user:${invocation.name}`) ??
    getSkillById(`project:${invocation.name}`);

  if (!skill) {
    return {
      systemPrompt: `(skill "${invocation.name}" not found — proceeding with the literal user prompt)`,
      allowedToolNames: null,
      unknownTokens: [],
    };
  }

  const { parseInvocationArgs } = await import('./substitute');
  const parsed = parseInvocationArgs(invocation.argsText);
  const { text, unknownTokens } = await resolveSkillBody(skill, parsed.args, context);

  const header = `[skill: ${skill.name}]`;
  const systemPrompt = `${header}\n${text}`;

  return {
    systemPrompt,
    allowedToolNames:
      skill.frontmatter.tools && skill.frontmatter.tools.length > 0
        ? skill.frontmatter.tools
        : null,
    unknownTokens,
  };
}
