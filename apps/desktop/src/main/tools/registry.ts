import { ToolRegistry } from '@opencodex/core';
import {
  editFileTool,
  globTool,
  grepTool,
  listDirTool,
  queryCodeGraphTool,
  readDocumentTool,
  readFileTool,
  runShellTool,
  searchCodebaseTool,
  webFetchTool,
  writeDocumentTool,
  writeFileTool,
} from '@opencodex/tools';
import { spawnSubagentTool } from '../agent/spawn-subagent-tool';

let instance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!instance) {
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(readDocumentTool);
    registry.register(globTool);
    registry.register(grepTool);
    registry.register(listDirTool);
    registry.register(writeFileTool);
    registry.register(writeDocumentTool);
    registry.register(editFileTool);
    registry.register(runShellTool);
    registry.register(webFetchTool);
    registry.register(searchCodebaseTool);
    registry.register(queryCodeGraphTool);
    registry.register(spawnSubagentTool);
    instance = registry;
  }
  return instance;
}

export function resetToolRegistryForTesting(): void {
  instance = null;
}
