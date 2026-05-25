import { ToolRegistry } from '@opencodex/core';
import {
  editFileTool,
  globTool,
  grepTool,
  listDirTool,
  readFileTool,
  runShellTool,
  searchCodebaseTool,
  webFetchTool,
  writeFileTool,
} from '@opencodex/tools';
import { spawnSubagentTool } from '../agent/spawn-subagent-tool';

let instance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!instance) {
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(globTool);
    registry.register(grepTool);
    registry.register(listDirTool);
    registry.register(writeFileTool);
    registry.register(editFileTool);
    registry.register(runShellTool);
    registry.register(webFetchTool);
    registry.register(searchCodebaseTool);
    registry.register(spawnSubagentTool);
    instance = registry;
  }
  return instance;
}

export function resetToolRegistryForTesting(): void {
  instance = null;
}
