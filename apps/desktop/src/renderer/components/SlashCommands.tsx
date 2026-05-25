import { useEffect, useMemo } from 'react';
import type { McpPromptEntry } from '../../shared/mcp';
import { filterPrompts, groupByServer } from './slash-commands';

interface SlashCommandsProps {
  query: string;
  prompts: ReadonlyArray<McpPromptEntry>;
  activeIndex: number;
  onSelect: (entry: McpPromptEntry) => void;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
}

export function SlashCommands({
  query,
  prompts,
  activeIndex,
  onSelect,
  onActiveIndexChange,
}: SlashCommandsProps): JSX.Element | null {
  const filtered = useMemo(() => filterPrompts(prompts, query), [prompts, query]);
  const groups = useMemo(() => groupByServer(filtered), [filtered]);

  useEffect(() => {
    if (activeIndex >= filtered.length && filtered.length > 0) {
      onActiveIndexChange(0);
    }
  }, [filtered.length, activeIndex, onActiveIndexChange]);

  if (filtered.length === 0) {
    return (
      <div className="slash-commands slash-commands-empty" role="listbox">
        <div className="slash-commands-empty-text">
          {prompts.length === 0
            ? 'No MCP prompts available. Connect an MCP server in Settings.'
            : `No prompts match "${query}"`}
        </div>
      </div>
    );
  }

  let flatIndex = 0;
  return (
    <div className="slash-commands" role="listbox" aria-label="MCP prompts">
      {groups.map((group) => (
        <div key={group.serverId} className="slash-commands-group">
          <div className="slash-commands-group-head">{group.serverDisplayName}</div>
          {group.prompts.map((entry) => {
            const idx = flatIndex++;
            const active = idx === activeIndex;
            return (
              <button
                key={`${entry.serverId}:${entry.prompt.name}`}
                type="button"
                role="option"
                aria-selected={active}
                className={`slash-commands-item${active ? ' slash-commands-item-active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(entry);
                }}
                onMouseEnter={() => onActiveIndexChange(idx)}
              >
                <span className="slash-commands-name">{entry.prompt.name}</span>
                {entry.prompt.description ? (
                  <span className="slash-commands-desc">{entry.prompt.description}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
