import { ToolRegistry } from '@opencodex/core';
import {
  editFileTool,
  globTool,
  grepTool,
  listDirTool,
  readFileTool,
  runShellTool,
  webFetchTool,
  writeFileTool,
} from '@opencodex/tools';

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
    instance = registry;
  }
  return instance;
}

export function resetToolRegistryForTesting(): void {
  instance = null;
}
