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
import { RoutingProvider, ToolRegistry } from '@opencodex/core';
import type { ChatStartResponse, ChatStreamEvent } from '../../shared/chat';
import type { ChatAttachment } from '../../shared/attachments';
import type { StoredMessage } from '../../shared/conversation';
import type { ShellOutputEvent } from '../../shared/shell-output';
import { buildShellTranscript } from '../../shared/shell-output';
import { isDiffProducingTool } from '../../shared/replay';
import { logger } from '../logger';
import { getActiveRoutingPolicy } from '../routing/routing-store';
import { getToolRegistry } from '../tools/registry';
import { detectSkillInvocation, resolveSkillInvocation } from '../skills/invoke';
import { appendMessage, listMessages, updateAssistantMessage } from '../storage/conversations';
import { recordAppliedDiff } from '../storage/applied-diffs';
import { recordToolCall, type ToolCallAuditDecision } from '../storage/tool-audit';
import { type ApprovalManager, type ApprovalOutcome, getApprovalManager } from './approvals';
import { BudgetExceededError, getBudgetManager } from './budget-manager';
import { buildChatSystemPrompt } from './system-prompt-builder';

const MAX_TOOL_ITERATIONS = 10;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;

interface RetryableErrorInfo {
  message: string;
}

function classifyProviderError(
  message: string,
  retryableHint?: boolean,
): { isRetryable: boolean; friendly: string } {
  const lower = message.toLowerCase();
  const looks429 =
    lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests');
  const looks5xx =
    /\b5\d\d\b/.test(lower) ||
    lower.includes('internal server error') ||
    lower.includes('bad gateway') ||
    lower.includes('service unavailable') ||
    lower.includes('gateway timeout');
  const looksAuth =
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('invalid api key') ||
    lower.includes('authentication');
  const looksBadReq = lower.includes('400') && !looks429;
  if (looksAuth || looksBadReq) return { isRetryable: false, friendly: message };
  const explicitlyRetryable = retryableHint === true;
  if (explicitlyRetryable || looks429 || looks5xx) {
    const friendly = looks429
      ? 'The provider rate-limited the request. Retrying.'
      : 'The provider had a temporary issue. Retrying.';
    return { isRetryable: true, friendly };
  }
  return { isRetryable: false, friendly: message };
}

async function sleepWithJitter(baseMs: number, signal: AbortSignal): Promise<void> {
  const jitter = Math.random() * baseMs;
  const total = baseMs + jitter;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, total);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

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
  const basePrimary = await builder(opts.providerId);
  // Lane 5 — if a routing policy is active, wrap the resolved provider in a
  // RoutingProvider so each turn can dispatch to the policy-matched provider.
  let provider: LLMProvider = basePrimary;
  try {
    const activePolicy = getActiveRoutingPolicy();
    if (activePolicy && activePolicy.rules.length > 0) {
      const referencedIds = new Set<string>([opts.providerId]);
      for (const rule of activePolicy.rules) {
        referencedIds.add(rule.use.providerId);
        if (rule.fallback) referencedIds.add(rule.fallback.providerId);
      }
      const providers = new Map<string, LLMProvider>();
      for (const pid of referencedIds) {
        try {
          providers.set(pid, pid === opts.providerId ? basePrimary : await builder(pid));
        } catch (err) {
          logger.warn({ err, providerId: pid }, 'routing: skipping unavailable provider');
        }
      }
      provider = new RoutingProvider({
        defaultRef: { providerId: opts.providerId, modelId: opts.modelId },
        policy: activePolicy,
        providers,
      });
    }
  } catch (err) {
    logger.warn({ err }, 'routing: failed to apply active policy — falling back to primary');
  }

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

  // Lane 7 — compose base system prompt (memory.md prepend + anti-sycophancy).
  try {
    const baseSystemPrompt = await buildChatSystemPrompt({ workspaceRoot });
    if (baseSystemPrompt !== null) {
      messages.unshift({ role: 'system', content: baseSystemPrompt });
    }
  } catch (err) {
    logger.warn({ err }, 'failed to build chat system prompt — continuing without prefix');
  }

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
    providerId: opts.providerId,
    conversationId: opts.conversationId,
    userPromptSnapshot: userDisplayText,
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
  providerId: string;
  conversationId: string;
  userPromptSnapshot: string;
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
      let retryError: RetryableErrorInfo | null = null;

      const runOneAttempt = async (): Promise<void> => {
        iterToolCalls.length = 0;
        iterText = '';
        iterStop = 'end_turn';
        retryError = null;
        // Lane: phase14-tier1-cost-ceiling — enforce budgets before each turn.
        try {
          getBudgetManager().check({
            conversationId: args.conversationId,
            providerId: args.providerId,
          });
        } catch (err) {
          if (err instanceof BudgetExceededError) throw err;
          logger.warn({ err }, 'budget check failed; allowing turn to proceed');
        }
        const iter = args.provider.chat({
          model: args.modelId,
          messages,
          signal: args.signal,
          ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
        });
        for await (const event of iter) {
          if (args.signal.aborted) break;
          if (event.type === 'text_delta') {
            // Don't stream partials until we know the attempt won't be retried.
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
            // Lane: phase14-tier1-cost-ceiling — accrue actual spend.
            if (event.costUsd !== undefined && event.costUsd > 0) {
              try {
                getBudgetManager().accrue({
                  conversationId: args.conversationId,
                  providerId: args.providerId,
                  costUsd: event.costUsd,
                });
              } catch (err) {
                logger.warn({ err }, 'budget accrue failed');
              }
            }
            emit(event);
          } else if (event.type === 'done') {
            iterStop = event.stopReason;
          } else if (event.type === 'error') {
            const classified = classifyProviderError(event.message, event.retryable);
            if (classified.isRetryable && iterText.length === 0 && iterToolCalls.length === 0) {
              retryError = { message: classified.friendly };
            } else {
              emit(event);
            }
          } else {
            emit(event);
          }
        }
      };

      let attempt = 0;
      let lastFriendly = '';
      while (true) {
        await runOneAttempt();
        if (args.signal.aborted) break;
        const pending = retryError as RetryableErrorInfo | null;
        if (!pending) break;
        lastFriendly = pending.message;
        attempt++;
        if (attempt >= MAX_RETRY_ATTEMPTS) {
          emit({
            type: 'error',
            message: `${lastFriendly} (gave up after ${MAX_RETRY_ATTEMPTS} attempts)`,
            retryable: false,
          });
          emit({ type: 'done', stopReason: 'error' });
          return;
        }
        const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
        logger.info(
          { streamId: args.streamId, attempt, delay },
          'chat stream retrying after retryable provider error',
        );
        await sleepWithJitter(delay, args.signal);
        if (args.signal.aborted) break;
      }

      if (args.signal.aborted) {
        if (!emittedDoneOrError) emit({ type: 'done', stopReason: 'end_turn' });
        return;
      }

      const finalStop = iterStop as StopReason;
      const shouldRunTools =
        iterToolCalls.length > 0 && finalStop === 'tool_use' && args.toolRegistry !== null;

      if (!shouldRunTools) {
        if (iterText.length > 0) allBlocks.push({ type: 'text', text: iterText });
        emit({ type: 'done', stopReason: finalStop });
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
    const isBudget = err instanceof BudgetExceededError;
    const rawMessage = err instanceof Error ? err.message : String(err);
    const message = isBudget ? `Budget exceeded — ${rawMessage}` : rawMessage;
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
    // Lane 6 — record diff-producing tool calls for replay / provenance.
    if (isDiffProducingTool(tc.name) && !args.signal.aborted) {
      try {
        const argsRecord = (tc.arguments ?? {}) as Record<string, unknown>;
        const filePath = typeof argsRecord.path === 'string' ? argsRecord.path : '<unknown>';
        const diffText = buildDiffSummaryFromToolCall(tc.name, argsRecord, output);
        recordAppliedDiff({
          conversationId: args.conversationId,
          messageId: args.assistantMessageId,
          toolCallId: tc.id,
          filePath,
          diff: diffText,
          promptSnapshot: args.userPromptSnapshot,
          providerId: args.providerId,
          modelId: args.modelId,
        });
      } catch (err) {
        logger.error(
          { err, tool: tc.name, streamId: args.streamId },
          'failed to record applied diff',
        );
      }
    }
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

function buildDiffSummaryFromToolCall(
  toolName: string,
  argsRecord: Record<string, unknown>,
  output: unknown,
): string {
  if (toolName === 'edit_file') {
    const oldStr = typeof argsRecord.oldString === 'string' ? argsRecord.oldString : '';
    const newStr = typeof argsRecord.newString === 'string' ? argsRecord.newString : '';
    const path = typeof argsRecord.path === 'string' ? argsRecord.path : '<unknown>';
    return `--- a/${path}\n+++ b/${path}\n@@ edit @@\n-${oldStr}\n+${newStr}\n`;
  }
  if (toolName === 'write_file') {
    const path = typeof argsRecord.path === 'string' ? argsRecord.path : '<unknown>';
    const content = typeof argsRecord.content === 'string' ? argsRecord.content : '';
    return `--- a/${path}\n+++ b/${path}\n@@ write @@\n+${content}\n`;
  }
  return typeof output === 'string' ? output : JSON.stringify(output ?? '');
}
