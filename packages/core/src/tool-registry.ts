import {
  ToolInputError,
  ToolNotFoundError,
  type PermissionTier,
  type Tool,
  type ToolContext,
  type ToolDefinition,
} from './tool';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      permissionTier: t.permissionTier,
    }));
  }

  listByTier(tier: PermissionTier): ToolDefinition[] {
    return this.list().filter((t) => t.permissionTier === tier);
  }

  async execute(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolNotFoundError(name);
    const parsed = tool.inputZod.safeParse(input);
    if (!parsed.success) throw new ToolInputError(name, parsed.error.issues);
    return tool.execute(parsed.data, ctx);
  }
}
