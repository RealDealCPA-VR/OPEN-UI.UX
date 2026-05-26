import { randomUUID } from 'node:crypto';
import type {
  ChatEvent,
  ContentBlock,
  LLMProvider,
  Message,
  Role,
  StopReason,
  ToolCallEvent,
} from '@opencodex/core';
import { ToolRegistry } from '@opencodex/core';
import type { ChatStartResponse, ChatStreamEvent } from '../../shared/chat';
import type { ChatAttachment } from '../../shared/attachments';
import type { StoredMessage } from '../../shared/conversation';
import type { ShellOutputEvent } from '../../shared/shell-output';
import { buildShellTranscript } from '../../shared/shell-output';
import { logger } from '../logger';
import { getToolRegistry } from '../tools/registry';
import { detectSkillInvocation, resolveSkillInvocation } from '../skills/invoke';
import { appendMessage, listMessages, updateAssistantMessage } from '../storage/conversations';
import { recordToolCall, type ToolCallAuditDecision } from '../storage/tool-audit';
import { type ApprovalManager, type ApprovalOutcome, getApprovalManager } from './approvals';

const MAX_TOOL_ITERATIONS = 10;

async function defaultBuildProvider(id: string): Promise<LLMProvider> {
  const mod = await import('./provider-builder');
  return mod.buildProviderForId(id);
}

export interface ChatStreamSink {
  emit(payload: ChatStreamEvent): void;
  emitShellOutput?(payload: ShellOutputEvent): void;
}

export interface StartChatStreamOptions {
  conversationId: string;
  providerId: string;
  modelId: string;
  userMessage: string;
  attachments?: ChatAttachment[];
  sink: ChatStreamSink;
  workspaceRoot?: string;
  buildProvider?: (id: string) => Promise<LLMProvider>;
  toolRegistry?: ToolRegistry | null;
  approvalManager?: ApprovalManager | null;
}

interface ActiveStream {
  controller: AbortController;
}

const active = new Map<string, ActiveStream>();

export async function startChatStream(opts: StartChatStreamOptions): Promise<ChatStartResponse> {
  const builder = opts.buildProvider ?? defaultBuildProvider;
  const provider = await builder(opts.providerId);

  const attachments = opts.attachments ?? [];
  const userBlocks = buildUserContentBlocks(opts.userMessage, attachments);
  const userDisplayText = buildUserDisplayText(opts.userMessage, attachments);

  const userRow = appendMessage({
    conversationId: opts.conversationId,
    role: 'user',
    content: userDisplayText,
    contentBlocks: userBlocks.length > 0 ? userBlocks : null,
    providerId: opts.providerId,
    modelId: opts.modelId,
  });

  const assistantRow = appendMessage({
    conversationId: opts.conversationId,
    role: 'assistant',
    content: '',
    providerId: opts.providerId,
    modelId: opts.modelId,
  });

  const history = listMessages(opts.conversationId);
  const messages: Message[] = expandStoredMessages(history.filter((m) => m.id !== assistantRow.id));

  const streamId = randomUUID();
  const controller = new AbortController();
  active.set(streamId, { controller });

  const workspaceRoot = opts.workspaceRoot ?? process.cwd();

  let registry = opts.toolRegistry === undefined ? getToolRegistry() : opts.toolRegistry;
  const approvals =
    opts.approvalManager === undefined ? safeGetApprovalManager() : opts.approvalManager;

  const skillInvocation = detectSkillInvocation(opts.userMessage);
  if (skillInvocation) {
    try {
      const resolved = await resolveSkillInvocation(skillInvocation, { workspace: workspaceRoot });
      if (resolved.systemPrompt) {
        messages.unshift({ role: 'system', content: resolved.systemPrompt });
      }
      if (resolved.allowedToolNames && resolved.allowedToolNames.length > 0 && registry) {
        registry = filterRegistry(registry, resolved.allowedToolNames);
      }
    } catch (err) {
      logger.warn({ err, skill: skillInvocation.name }, 'failed to resolve skill invocation');
    }
  }

  void runStream({
    streamId,
    provider,
    modelId: opts.modelId,
    messages,
    assistantMessageId: assistantRow.id,
    sink: opts.sink,
    signal: controller.signal,
    workspaceRoot,
    toolRegistry: registry,
    approvalManager: approvals,
  }).finally(() => {
    active.delete(streamId);
    approvals?.clearSession(streamId);
  });

  return {
    streamId,
    userMessageId: userRow.id,
    assistantMessageId: assistantRow.id,
    workspaceRoot,
  };
}

export function cancelChatStream(streamId: string): void {
  const entry = active.get(streamId);
  if (!entry) return;
  entry.controller.abort();
}

export function activeStreamCount(): number {
  return active.size;
}

interface RunStreamArgs {
  streamId: string;
  provider: LLMProvider;
  modelId: string;
  messages: Message[];
  assistantMessageId: string;
  sink: ChatStreamSink;
  signal: AbortSignal;
  workspaceRoot: string;
  toolRegistry: ToolRegistry | null;
  approvalManager: ApprovalManager | null;
}

function safeGetApprovalManager(): ApprovalManager | null {
  try {
    return getApprovalManager();
  } catch {
    return null;
  }
}

async function runStream(args: RunStreamArgs): Promise<void> {
  let buffer = '';
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let costUsd: number | null = null;
  let emittedDoneOrError = false;
  const messages: Message[] = [...args.messages];
  const allBlocks: ContentBlock[] = [];

  const emit = (event: ChatEvent): void => {
    args.sink.emit({ streamId: args.streamId, event });
    if (event.type === 'done' || event.type === 'error') {
      emittedDoneOrError = true;
    }
  };

  const toolDefs = args.toolRegistry?.list() ?? [];

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const iterToolCalls: ToolCallEvent[] = [];
      let iterText = '';
      let iterStop: StopReason = 'end_turn';

      const iter = args.provider.chat({
        model: args.modelId,
        messages,
        signal: args.signal,
        ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
      });

      for await (const event of iter) {
        if (args.signal.aborted) break;
        if (event.type === 'text_delta') {
          buffer += event.delta;
          iterText += event.delta;
          emit(event);
        } else if (event.type === 'tool_call') {
          iterToolCalls.push(event);
          emit(event);
        } else if (event.type === 'usage') {
          inputTokens = (inputTokens ?? 0) + event.inputTokens;
          outputTokens = (outputTokens ?? 0) + event.outputTokens;
          if (event.costUsd !== undefined) costUsd = (costUsd ?? 0) + event.costUsd;
          emit(event);
        } else if (event.type === 'done') {
          iterStop = event.stopReason;
        } else {
          emit(event);
        }
      }

      if (args.signal.aborted) {
        if (!emittedDoneOrError) emit({ type: 'done', stopReason: 'end_turn' });
        return;
      }

      const shouldRunTools =
        iterToolCalls.length > 0 && iterStop === 'tool_use' && args.toolRegistry !== null;

      if (!shouldRunTools) {
        if (iterText.length > 0) allBlocks.push({ type: 'text', text: iterText });
        emit({ type: 'done', stopReason: iterStop });
        return;
      }

      const assistantBlocks: ContentBlock[] = [];
      if (iterText.length > 0) {
        const textBlock: ContentBlock = { type: 'text', text: iterText };
        assistantBlocks.push(textBlock);
        allBlocks.push(textBlock);
      }
      for (const tc of iterToolCalls) {
        const toolUseBlock: ContentBlock = {
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        };
        assistantBlocks.push(toolUseBlock);
        allBlocks.push(toolUseBlock);
      }
      messages.push({ role: 'assistant', content: assistantBlocks });

      const toolBlocks: ContentBlock[] = [];
      for (const tc of iterToolCalls) {
        const result = await executeToolCall(tc, args);
        broadcastShellOutputIfApplicable(args, tc, result);
        emit({ type: 'tool_result', id: tc.id, output: result.output, isError: result.isError });
        const toolResultBlock: ContentBlock = {
          type: 'tool_result',
          toolUseId: tc.id,
          output: result.output,
          isError: result.isError,
        };
        toolBlocks.push(toolResultBlock);
        allBlocks.push(toolResultBlock);
      }
      messages.push({ role: 'tool', content: toolBlocks });
    }

    emit({
      type: 'error',
      message: `Agent loop exceeded ${MAX_TOOL_ITERATIONS} tool iterations`,
      retryable: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, streamId: args.streamId }, 'chat stream errored');
    if (!emittedDoneOrError) {
      emit({ type: 'error', message, retryable: false });
    }
  } finally {
    try {
      const hasToolBlocks = allBlocks.some(
        (b) => b.type === 'tool_use' || b.type === 'tool_result',
      );
      updateAssistantMessage(args.assistantMessageId, {
        content: buffer,
        contentBlocks: hasToolBlocks ? allBlocks : null,
        inputTokens,
        outputTokens,
        costUsd,
      });
    } catch (err) {
      logger.error(
        { err, assistantMessageId: args.assistantMessageId },
        'failed to persist assistant message',
      );
    }
  }
}

function buildUserContentBlocks(
  userMessage: string,
  attachments: readonly ChatAttachment[],
): ContentBlock[] {
  if (attachments.length === 0) return [];
  const blocks: ContentBlock[] = [];
  for (const att of attachments) {
    if (att.kind === 'image') {
      blocks.push({ type: 'image', mimeType: att.mimeType, data: att.data });
    }
  }
  const text = buildUserDisplayText(userMessage, attachments);
  blocks.push({ type: 'text', text });
  return blocks;
}

function buildUserDisplayText(userMessage: string, attachments: readonly ChatAttachment[]): string {
  const parts: string[] = [];
  if (userMessage.length > 0) parts.push(userMessage);
  for (const att of attachments) {
    if (att.kind === 'text') {
      const header = `\n\n--- Attached file: ${att.name} (${att.path})${att.truncated ? ' [truncated]' : ''} ---\n`;
      parts.push(`${header}\`\`\`\n${att.text}\n\`\`\``);
    } else if (att.kind === 'binary') {
      parts.push(`\n\n[Attached binary file: ${att.name} at ${att.path} (${att.sizeBytes} bytes)]`);
    } else {
      parts.push(`\n\n[Attached image: ${att.name}]`);
    }
  }
  return parts.join('');
}

export function expandStoredMessages(stored: StoredMessage[]): Message[] {
  const out: Message[] = [];
  for (const m of stored) {
    if (m.contentBlocks && m.contentBlocks.length > 0) {
      if (m.role === 'assistant') {
        out.push(...expandAssistantTurn(m.contentBlocks));
      } else {
        out.push({ role: m.role, content: m.contentBlocks });
      }
    } else if (m.content.length > 0) {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

function expandAssistantTurn(blocks: ContentBlock[]): Message[] {
  const out: Message[] = [];
  let pending: ContentBlock[] = [];
  let pendingRole: Role | null = null;

  const flush = () => {
    if (pending.length > 0 && pendingRole !== null) {
      out.push({ role: pendingRole, content: pending });
      pending = [];
      pendingRole = null;
    }
  };

  for (const block of blocks) {
    const blockRole: Role = block.type === 'tool_result' ? 'tool' : 'assistant';
    if (pendingRole !== null && pendingRole !== blockRole) flush();
    pendingRole = blockRole;
    pending.push(block);
  }
  flush();
  return out;
}

interface ToolExecutionResult {
  output: unknown;
  isError: boolean;
}

async function executeToolCall(
  tc: ToolCallEvent,
  args: RunStreamArgs,
): Promise<ToolExecutionResult> {
  const registry = args.toolRegistry;
  if (!registry) {
    const output = `Tool "${tc.name}" is not available`;
    auditToolCall(args, tc, { output, isError: true, decision: 'denied', durationMs: null });
    return { output, isError: true };
  }
  const tool = registry.get(tc.name);
  if (!tool) {
    const output = `Tool "${tc.name}" is not registered`;
    auditToolCall(args, tc, { output, isError: true, decision: 'denied', durationMs: null });
    return { output, isError: true };
  }
  let outcome: ApprovalOutcome = { decision: 'allow', source: 'policy' };
  if (tool.permissionTier !== 'read') {
    if (!args.approvalManager) {
      const output = `Tool "${tc.name}" requires approval (tier "${tool.permissionTier}") but no approval manager is configured`;
      auditToolCall(args, tc, { output, isError: true, decision: 'denied', durationMs: null });
      return { output, isError: true };
    }
    try {
      outcome = await args.approvalManager.requestApproval({
        streamId: args.streamId,
        toolName: tc.name,
        toolDescription: tool.description,
        permissionTier: tool.permissionTier,
        arguments: tc.arguments,
        signal: args.signal,
      });
      if (outcome.decision === 'deny') {
        const output = `Tool "${tc.name}" was denied by user policy`;
        auditToolCall(args, tc, { output, isError: true, decision: 'denied', durationMs: null });
        return { output, isError: true };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const output = `Tool "${tc.name}" approval failed: ${msg}`;
      auditToolCall(args, tc, { output, isError: true, decision: 'denied', durationMs: null });
      return { output, isError: true };
    }
  }
  const startedAt = Date.now();
  try {
    const output = await registry.execute(tc.name, tc.arguments, {
      workspaceRoot: args.workspaceRoot,
      signal: args.signal,
      logger: {
        info: (msg, meta) => logger.info({ tool: tc.name, meta }, msg),
        error: (msg, meta) => logger.error({ tool: tc.name, meta }, msg),
      },
    });
    auditToolCall(args, tc, {
      output,
      isError: false,
      decision: outcomeToAuditDecision(outcome),
      durationMs: Date.now() - startedAt,
    });
    return { output, isError: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, tool: tc.name, streamId: args.streamId }, 'tool execution failed');
    auditToolCall(args, tc, {
      output: msg,
      isError: true,
      decision: outcomeToAuditDecision(outcome),
      durationMs: Date.now() - startedAt,
    });
    return { output: msg, isError: true };
  }
}

function outcomeToAuditDecision(outcome: ApprovalOutcome): ToolCallAuditDecision {
  if (outcome.decision === 'deny') return 'denied';
  switch (outcome.source) {
    case 'policy':
      return 'auto';
    case 'prompt-once':
      return 'prompt-allowed';
    case 'prompt-session':
      return 'prompt-allowed-session';
    case 'prompt-always':
      return 'prompt-allowed-always';
  }
}

interface AuditPatch {
  output: unknown;
  isError: boolean;
  decision: ToolCallAuditDecision;
  durationMs: number | null;
}

function broadcastShellOutputIfApplicable(
  args: RunStreamArgs,
  tc: ToolCallEvent,
  result: ToolExecutionResult,
): void {
  if (!args.sink.emitShellOutput) return;
  if (tc.name !== 'run_shell') return;
  if (result.isError) {
    const message =
      typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
    safeEmitShellOutput(args, {
      streamId: args.streamId,
      toolUseId: tc.id,
      stream: 'meta',
      chunk: `\x1b[31m${message}\x1b[0m\r\n`,
      final: true,
    });
    return;
  }
  const parsed = parseShellResult(result.output);
  if (!parsed) return;
  const command =
    typeof (tc.arguments as Record<string, unknown>)?.command === 'string'
      ? ((tc.arguments as Record<string, unknown>).command as string)
      : undefined;
  const cwd =
    typeof (tc.arguments as Record<string, unknown>)?.cwd === 'string'
      ? ((tc.arguments as Record<string, unknown>).cwd as string)
      : undefined;
  const transcript = buildShellTranscript({
    stdout: parsed.stdout,
    stderr: parsed.stderr,
    exitCode: parsed.exitCode,
    signal: parsed.signal,
    truncatedStdout: parsed.truncatedStdout,
    truncatedStderr: parsed.truncatedStderr,
    timedOut: parsed.timedOut,
    durationMs: parsed.durationMs,
    ...(command ? { command } : {}),
    ...(cwd ? { cwd } : {}),
  });
  safeEmitShellOutput(args, {
    streamId: args.streamId,
    toolUseId: tc.id,
    stream: 'meta',
    chunk: `${transcript}\r\n`,
    final: true,
  });
}

function safeEmitShellOutput(args: RunStreamArgs, payload: ShellOutputEvent): void {
  try {
    args.sink.emitShellOutput?.(payload);
  } catch (err) {
    logger.error({ err, streamId: args.streamId }, 'failed to emit shell:output');
  }
}

interface ParsedShellResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  truncatedStdout: boolean;
  truncatedStderr: boolean;
  timedOut: boolean;
  durationMs: number;
}

function parseShellResult(output: unknown): ParsedShellResult | null {
  if (typeof output !== 'object' || output === null) return null;
  const o = output as Record<string, unknown>;
  if (typeof o.stdout !== 'string') return null;
  if (typeof o.stderr !== 'string') return null;
  if (o.exitCode !== null && typeof o.exitCode !== 'number') return null;
  if (o.signal !== null && typeof o.signal !== 'string') return null;
  if (typeof o.truncatedStdout !== 'boolean') return null;
  if (typeof o.truncatedStderr !== 'boolean') return null;
  if (typeof o.timedOut !== 'boolean') return null;
  if (typeof o.durationMs !== 'number') return null;
  return {
    stdout: o.stdout,
    stderr: o.stderr,
    exitCode: o.exitCode as number | null,
    signal: o.signal as string | null,
    truncatedStdout: o.truncatedStdout,
    truncatedStderr: o.truncatedStderr,
    timedOut: o.timedOut,
    durationMs: o.durationMs,
  };
}

/**
 * Build a filtered view over the global ToolRegistry that only exposes a
 * named subset. Does NOT mutate the underlying registry — the wrapper is
 * scoped to the current turn and discarded after.
 */
function filterRegistry(base: ToolRegistry, allowed: readonly string[]): ToolRegistry {
  const allowSet = new Set(allowed);
  const filtered = new ToolRegistry();
  for (const def of base.list()) {
    if (!allowSet.has(def.name)) continue;
    const tool = base.get(def.name);
    if (!tool) continue;
    filtered.register(tool);
  }
  return filtered;
}

function auditToolCall(args: RunStreamArgs, tc: ToolCallEvent, patch: AuditPatch): void {
  try {
    recordToolCall({
      messageId: args.assistantMessageId,
      toolName: tc.name,
      input: tc.arguments,
      output: patch.output,
      decision: patch.decision,
      isError: patch.isError,
      durationMs: patch.durationMs,
    });
  } catch (err) {
    logger.error(
      { err, tool: tc.name, streamId: args.streamId },
      'failed to record tool call audit row',
    );
  }
}
