import { useEffect, useMemo } from 'react';
import type { McpPromptEntry } from '../../shared/mcp';
import type { PluginSlashCommandDescriptor } from '../../shared/plugins';
import type { Skill } from '../../shared/skills';
import { buildSlashGroups, type SlashEntry } from './slash-commands';

interface SlashCommandsProps {
  query: string;
  prompts: ReadonlyArray<McpPromptEntry>;
  skills: ReadonlyArray<Skill>;
  pluginCommands: ReadonlyArray<PluginSlashCommandDescriptor>;
  activeIndex: number;
  onSelectMcp: (entry: McpPromptEntry) => void;
  onSelectSkill: (skill: Skill) => void;
  onSelectPlugin: (command: PluginSlashCommandDescriptor) => void;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
}

function flattenEntries(groups: ReturnType<typeof buildSlashGroups>): SlashEntry[] {
  const out: SlashEntry[] = [];
  for (const g of groups) {
    for (const e of g.entries) out.push(e);
  }
  return out;
}

export function SlashCommands({
  query,
  prompts,
  skills,
  pluginCommands,
  activeIndex,
  onSelectMcp,
  onSelectSkill,
  onSelectPlugin,
  onActiveIndexChange,
}: SlashCommandsProps): JSX.Element | null {
  const groups = useMemo(
    () => buildSlashGroups(prompts, skills, query, pluginCommands),
    [prompts, skills, query, pluginCommands],
  );
  const flat = useMemo(() => flattenEntries(groups), [groups]);

  useEffect(() => {
    if (activeIndex >= flat.length && flat.length > 0) {
      onActiveIndexChange(0);
    }
  }, [flat.length, activeIndex, onActiveIndexChange]);

  if (flat.length === 0) {
    return (
      <div className="slash-commands slash-commands-empty" role="listbox">
        <div className="slash-commands-empty-text">
          {prompts.length === 0 && skills.length === 0 && pluginCommands.length === 0
            ? 'No skills, MCP prompts, or plugin commands available. Add a skill in Settings → Skills, connect an MCP server, or install a plugin.'
            : `No matches for "${query}"`}
        </div>
      </div>
    );
  }

  let flatIndex = 0;
  return (
    <div className="slash-commands" role="listbox" aria-label="Slash commands">
      {groups.map((group) => (
        <div key={group.header} className="slash-commands-group">
          <div className="slash-commands-group-head">{group.header}</div>
          {group.entries.map((entry) => {
            const idx = flatIndex++;
            const active = idx === activeIndex;
            const key =
              entry.kind === 'mcp'
                ? `mcp:${entry.entry.serverId}:${entry.entry.prompt.name}`
                : entry.kind === 'skill'
                  ? `skill:${entry.skill.id}`
                  : `plugin:${entry.command.pluginId}:${entry.command.name}`;
            const name =
              entry.kind === 'mcp'
                ? entry.entry.prompt.name
                : entry.kind === 'skill'
                  ? `skill:${entry.skill.name}`
                  : entry.command.name;
            const desc =
              entry.kind === 'mcp'
                ? (entry.entry.prompt.description ?? '')
                : entry.kind === 'skill'
                  ? entry.skill.description
                  : (entry.command.description ?? '');
            const scopeBadge =
              entry.kind === 'skill' && entry.skill.scope === 'project' ? 'project' : null;
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={active}
                className={`slash-commands-item${active ? ' slash-commands-item-active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (entry.kind === 'mcp') onSelectMcp(entry.entry);
                  else if (entry.kind === 'skill') onSelectSkill(entry.skill);
                  else onSelectPlugin(entry.command);
                }}
                onMouseEnter={() => onActiveIndexChange(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                }}
              >
                <span className="slash-commands-name" style={{ flexShrink: 0 }}>
                  {name}
                  {scopeBadge && <span className="pill pill-local">{scopeBadge}</span>}
                </span>
                {desc ? (
                  <span className="slash-commands-desc slash-commands-desc-right" title={desc}>
                    {desc}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
