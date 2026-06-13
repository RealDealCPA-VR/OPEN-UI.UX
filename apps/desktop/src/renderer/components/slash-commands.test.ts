import { describe, expect, it } from 'vitest';
import type { McpPromptEntry } from '../../shared/mcp';
import type { PluginSlashCommandDescriptor } from '../../shared/plugins';
import type { Skill } from '../../shared/skills';
import {
  applyInsert,
  buildSlashGroups,
  detectPluginCommandInvocation,
  filterPluginCommands,
  filterPrompts,
  filterSkills,
  findSkillsForTriggerText,
  formatPluginCommandInsert,
  formatPromptInsert,
  formatSkillInsert,
  getSlashTrigger,
  groupByPlugin,
  groupByServer,
} from './slash-commands';

const pluginCmd = (
  pluginId: string,
  pluginName: string,
  name: string,
  description?: string,
): PluginSlashCommandDescriptor => ({
  pluginId,
  pluginName,
  name,
  ...(description !== undefined ? { description } : {}),
});

function makeSkill(
  name: string,
  opts: Partial<Skill['frontmatter']> & { disabled?: boolean; scope?: 'user' | 'project' } = {},
): Skill {
  const { disabled, scope, ...fm } = opts;
  return {
    id: `${scope ?? 'user'}:${name}`,
    name,
    scope: scope ?? 'user',
    description: fm.description ?? `${name} description`,
    frontmatter: {
      name,
      description: fm.description ?? `${name} description`,
      ...(fm.triggers ? { triggers: fm.triggers } : {}),
      ...(fm.tools ? { tools: fm.tools } : {}),
      ...(fm.arguments ? { arguments: fm.arguments } : {}),
      ...(fm.cron ? { cron: fm.cron } : {}),
    },
    body: 'body',
    sourcePath: `/tmp/${name}/SKILL.md`,
    disabled: disabled ?? false,
  };
}

const entry = (
  serverId: string,
  name: string,
  opts: { description?: string; args?: Array<{ name: string; required?: boolean }> } = {},
): McpPromptEntry => ({
  serverId,
  serverDisplayName: serverId,
  prompt: {
    name,
    ...(opts.description !== undefined ? { description: opts.description } : {}),
    ...(opts.args !== undefined ? { arguments: opts.args } : {}),
  },
});

describe('getSlashTrigger', () => {
  it('detects a leading slash at start of input', () => {
    expect(getSlashTrigger('/', 1)).toEqual({ query: '', start: 0 });
  });

  it('captures the query after the slash', () => {
    expect(getSlashTrigger('/foo', 4)).toEqual({ query: 'foo', start: 0 });
  });

  it('returns null when slash is not at start of line', () => {
    expect(getSlashTrigger('hello /foo', 10)).toBeNull();
  });

  it('detects slash after a newline', () => {
    expect(getSlashTrigger('first\n/foo', 10)).toEqual({ query: 'foo', start: 6 });
  });

  it('returns null after whitespace breaks the token', () => {
    expect(getSlashTrigger('/foo bar', 8)).toBeNull();
  });

  it('returns null when there is no slash', () => {
    expect(getSlashTrigger('hello', 5)).toBeNull();
  });

  it('returns null when caret is before the slash', () => {
    expect(getSlashTrigger('/foo', 0)).toBeNull();
  });

  it('handles caret between slash and end', () => {
    expect(getSlashTrigger('/foobar', 4)).toEqual({ query: 'foo', start: 0 });
  });
});

describe('filterPrompts', () => {
  const prompts = [
    entry('git', 'commit', { description: 'create a commit' }),
    entry('git', 'branch'),
    entry('fs', 'read-file', { description: 'open a file' }),
  ];

  it('returns all entries on empty query', () => {
    expect(filterPrompts(prompts, '').length).toBe(3);
  });

  it('filters by prompt name', () => {
    expect(filterPrompts(prompts, 'comm').map((e) => e.prompt.name)).toEqual(['commit']);
  });

  it('filters by server id', () => {
    expect(filterPrompts(prompts, 'fs').map((e) => e.prompt.name)).toEqual(['read-file']);
  });

  it('filters by description', () => {
    expect(filterPrompts(prompts, 'open').map((e) => e.prompt.name)).toEqual(['read-file']);
  });

  it('is case-insensitive', () => {
    expect(filterPrompts(prompts, 'COMM').length).toBe(1);
  });

  it('returns empty when no matches', () => {
    expect(filterPrompts(prompts, 'zzz')).toEqual([]);
  });
});

describe('groupByServer', () => {
  it('groups entries under their serverId preserving order', () => {
    const result = groupByServer([
      entry('git', 'commit'),
      entry('fs', 'read'),
      entry('git', 'branch'),
    ]);
    expect(result.map((g) => g.serverId)).toEqual(['git', 'fs']);
    expect(result[0]?.prompts.map((p) => p.prompt.name)).toEqual(['commit', 'branch']);
    expect(result[1]?.prompts.map((p) => p.prompt.name)).toEqual(['read']);
  });

  it('returns empty array for empty input', () => {
    expect(groupByServer([])).toEqual([]);
  });
});

describe('formatPromptInsert', () => {
  it('formats prompt without arguments', () => {
    expect(formatPromptInsert(entry('git', 'commit'))).toBe('/git:commit ');
  });

  it('formats prompt with required arguments', () => {
    const e = entry('git', 'commit', {
      args: [
        { name: 'message', required: true },
        { name: 'scope', required: true },
      ],
    });
    expect(formatPromptInsert(e)).toBe('/git:commit message=<message> scope=<scope>');
  });

  it('formats optional arguments with a ? marker', () => {
    const e = entry('git', 'commit', {
      args: [{ name: 'amend', required: false }],
    });
    expect(formatPromptInsert(e)).toBe('/git:commit amend=<amend?>');
  });
});

describe('applyInsert', () => {
  it('replaces the slash trigger with the formatted insert', () => {
    const trigger = { query: 'co', start: 0 };
    const result = applyInsert('/co rest', trigger, 3, '/git:commit ');
    expect(result.value).toBe('/git:commit  rest');
    expect(result.caret).toBe('/git:commit '.length);
  });

  it('preserves text before and after the trigger', () => {
    const value = 'line1\n/foo';
    const trigger = { query: 'foo', start: 6 };
    const result = applyInsert(value, trigger, 10, '/git:commit ');
    expect(result.value).toBe('line1\n/git:commit ');
    expect(result.caret).toBe('line1\n/git:commit '.length);
  });
});

describe('filterSkills', () => {
  const skills = [
    makeSkill('daily-standup', { description: 'standup report' }),
    makeSkill('security-audit', { description: 'find secrets' }),
    makeSkill('dependency-check', { description: 'outdated deps' }),
    makeSkill('disabled-one', { description: 'should never show', disabled: true }),
  ];

  it('returns all enabled skills on empty query', () => {
    const result = filterSkills(skills, '');
    expect(result.map((s) => s.name)).toEqual([
      'daily-standup',
      'security-audit',
      'dependency-check',
    ]);
  });

  it('filters by skill name', () => {
    expect(filterSkills(skills, 'security').map((s) => s.name)).toEqual(['security-audit']);
  });

  it('filters by description', () => {
    expect(filterSkills(skills, 'secret').map((s) => s.name)).toEqual(['security-audit']);
  });

  it('is case-insensitive', () => {
    expect(filterSkills(skills, 'SECURITY').length).toBe(1);
  });

  it('matches the skill: prefix', () => {
    expect(filterSkills(skills, 'skill:depend').length).toBe(1);
  });

  it('excludes disabled skills', () => {
    expect(filterSkills(skills, 'disabled').length).toBe(0);
  });
});

describe('formatSkillInsert', () => {
  it('formats a skill without arguments', () => {
    expect(formatSkillInsert(makeSkill('foo'))).toBe('/skill:foo ');
  });

  it('formats a skill with required arguments', () => {
    const s = makeSkill('foo', {
      arguments: [{ name: 'topic', description: 't', required: true }],
    });
    expect(formatSkillInsert(s)).toBe('/skill:foo topic=<topic>');
  });

  it('marks optional arguments with a ? suffix', () => {
    const s = makeSkill('foo', {
      arguments: [{ name: 'amend', description: 'a', required: false }],
    });
    expect(formatSkillInsert(s)).toBe('/skill:foo amend=<amend?>');
  });
});

describe('buildSlashGroups', () => {
  it('puts the Skills group before MCP groups', () => {
    const skills = [makeSkill('foo')];
    const prompts: McpPromptEntry[] = [
      { serverId: 'git', serverDisplayName: 'git', prompt: { name: 'commit' } },
    ];
    const groups = buildSlashGroups(prompts, skills, '');
    expect(groups[0]?.header).toBe('Skills');
    expect(groups[1]?.header).toBe('MCP — git');
  });

  it('omits empty groups', () => {
    const groups = buildSlashGroups([], [], '');
    expect(groups).toEqual([]);
  });

  it('filters by query across both', () => {
    const skills = [makeSkill('security-audit', { description: 'desc' })];
    const prompts: McpPromptEntry[] = [
      { serverId: 'git', serverDisplayName: 'git', prompt: { name: 'commit' } },
    ];
    const groups = buildSlashGroups(prompts, skills, 'security');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.header).toBe('Skills');
  });
});

describe('filterPluginCommands', () => {
  const commands = [
    pluginCmd('p1', 'Deploy Tools', 'deploy', 'ship to prod'),
    pluginCmd('p1', 'Deploy Tools', 'rollback'),
    pluginCmd('p2', 'Linter', 'lint', 'check style'),
  ];

  it('returns all commands on empty query', () => {
    expect(filterPluginCommands(commands, '').length).toBe(3);
  });

  it('filters by command name', () => {
    expect(filterPluginCommands(commands, 'roll').map((c) => c.name)).toEqual(['rollback']);
  });

  it('filters by plugin name', () => {
    expect(filterPluginCommands(commands, 'linter').map((c) => c.name)).toEqual(['lint']);
  });

  it('filters by description', () => {
    expect(filterPluginCommands(commands, 'prod').map((c) => c.name)).toEqual(['deploy']);
  });

  it('is case-insensitive', () => {
    expect(filterPluginCommands(commands, 'LINTER').map((c) => c.name)).toEqual(['lint']);
  });

  it('returns empty when no matches', () => {
    expect(filterPluginCommands(commands, 'zzz')).toEqual([]);
  });
});

describe('groupByPlugin', () => {
  it('groups commands under their plugin preserving order', () => {
    const result = groupByPlugin([
      pluginCmd('p1', 'One', 'a'),
      pluginCmd('p2', 'Two', 'b'),
      pluginCmd('p1', 'One', 'c'),
    ]);
    expect(result.map((g) => g.pluginId)).toEqual(['p1', 'p2']);
    expect(result[0]?.commands.map((c) => c.name)).toEqual(['a', 'c']);
    expect(result[1]?.commands.map((c) => c.name)).toEqual(['b']);
  });
});

describe('formatPluginCommandInsert', () => {
  it('formats a plugin command with a trailing space', () => {
    expect(formatPluginCommandInsert(pluginCmd('p1', 'One', 'deploy'))).toBe('/deploy ');
  });
});

describe('buildSlashGroups with plugin commands', () => {
  it('appends Plugin groups after Skills and MCP groups', () => {
    const skills = [makeSkill('foo')];
    const prompts: McpPromptEntry[] = [
      { serverId: 'git', serverDisplayName: 'git', prompt: { name: 'commit' } },
    ];
    const commands = [pluginCmd('p1', 'Deploy Tools', 'deploy')];
    const groups = buildSlashGroups(prompts, skills, '', commands);
    expect(groups.map((g) => g.header)).toEqual(['Skills', 'MCP — git', 'Plugin — Deploy Tools']);
    const pluginGroup = groups[2];
    expect(pluginGroup?.entries[0]?.kind).toBe('plugin');
  });

  it('filters plugin commands by query', () => {
    const commands = [
      pluginCmd('p1', 'Deploy Tools', 'deploy', 'ship'),
      pluginCmd('p2', 'Linter', 'lint', 'style'),
    ];
    const groups = buildSlashGroups([], [], 'lint', commands);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.header).toBe('Plugin — Linter');
  });

  it('omits plugin groups when no commands are supplied', () => {
    const groups = buildSlashGroups([], [makeSkill('foo')], '');
    expect(groups.every((g) => !g.header.startsWith('Plugin'))).toBe(true);
  });
});

describe('detectPluginCommandInvocation', () => {
  const commands = [pluginCmd('p1', 'Deploy Tools', 'deploy'), pluginCmd('p2', 'Linter', 'lint')];

  it('matches a bare command with empty args', () => {
    expect(detectPluginCommandInvocation('/deploy', commands)).toEqual({
      command: commands[0],
      args: '',
    });
  });

  it('captures everything after the command name as the args string', () => {
    expect(detectPluginCommandInvocation('/deploy prod --fast', commands)).toEqual({
      command: commands[0],
      args: 'prod --fast',
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(detectPluginCommandInvocation('  /lint src  ', commands)).toEqual({
      command: commands[1],
      args: 'src',
    });
  });

  it('returns null for unknown command names', () => {
    expect(detectPluginCommandInvocation('/unknown thing', commands)).toBeNull();
  });

  it('returns null for skill-style and MCP-style tokens', () => {
    expect(detectPluginCommandInvocation('/skill:deploy', commands)).toBeNull();
    expect(detectPluginCommandInvocation('/git:deploy', commands)).toBeNull();
  });

  it('never intercepts multi-line messages', () => {
    expect(detectPluginCommandInvocation('/deploy prod\nand more prose', commands)).toBeNull();
  });

  it('returns null for non-slash text, a bare slash, and an empty registry', () => {
    expect(detectPluginCommandInvocation('deploy', commands)).toBeNull();
    expect(detectPluginCommandInvocation('/', commands)).toBeNull();
    expect(detectPluginCommandInvocation('/deploy', [])).toBeNull();
  });
});

describe('findSkillsForTriggerText', () => {
  const skills = [
    makeSkill('audit', { triggers: ['security audit', 'secret scan'] }),
    makeSkill('standup', { triggers: ['daily summary'] }),
    makeSkill('disabled-one', { triggers: ['anything'], disabled: true }),
  ];

  it('returns skills whose triggers match a substring of the text', () => {
    const result = findSkillsForTriggerText(skills, "let's do a security audit later");
    expect(result.map((s) => s.name)).toEqual(['audit']);
  });

  it('is case-insensitive', () => {
    const result = findSkillsForTriggerText(skills, 'SECURITY AUDIT please');
    expect(result.map((s) => s.name)).toEqual(['audit']);
  });

  it('excludes disabled skills', () => {
    expect(findSkillsForTriggerText(skills, 'anything').length).toBe(0);
  });

  it('returns empty for empty text', () => {
    expect(findSkillsForTriggerText(skills, '')).toEqual([]);
  });
});
