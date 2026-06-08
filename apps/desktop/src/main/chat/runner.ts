import { randomUUID } from 'node:crypto';
import type {
  ChatEvent,
  ContentBlock,
  LLMProvider,
  Message,
  Role,
  RoutingDecision,
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
import { captureBeforeMutation, isMutatingTool } from '../checkpoints/manager';
import { recordToolCall, type ToolCallAuditDecision } from '../storage/tool-audit';
import { type ApprovalManager, type ApprovalOutcome, getApprovalManager } from './approvals';
import { BudgetExceededError, getBudgetManager } from './budget-manager';
import { buildChatSystemPrompt } from './system-prompt-builder';
import { autoTitleConversation } from './auto-title';

const MAX_TOOL_ITERATIONS = 10;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;
const CHECKPOINT_MS = 750;

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
  /** When true, name a still-untitled conversation from its first exchange. */
  autoTitle?: boolean;
}

interface ActiveStream {
  controller: AbortController;
  conversationId: string;
  assistantMessageId: string;
}

const active = new Map<string, ActiveStream>();
// Crash-restore — index of live streams keyed by conversation so the renderer
// can ask "is conversation X still streaming?" on reattach.
const activeByConversation = new Map<string, ActiveStream>();

export interface ActiveStreamSummary {
  conversationId: string;
  streamId: string;
  assistantMessageId: string;
}

export function listActiveStreams(): ActiveStreamSummary[] {
  const out: ActiveStreamSummary[] = [];
  for (const [streamId, entry] of active) {
    out.push({
      streamId,
      conversationId: entry.conversationId,
      assistantMessageId: entry.assistantMessageId,
    });
  }
  return out;
}

export function getActivePartial(conversationId: string): StoredMessage | null {
  const entry = activeByConversation.get(conversationId);
  if (!entry) return null;
  const rows = listMessages(conversationId);
  return rows.find((m) => m.id === entry.assistantMessageId) ?? null;
}

export async function startChatStream(opts: StartChatStreamOptions): Promise<ChatStartResponse> {
  const builder = opts.buildProvider ?? defaultBuildProvider;
  const basePrimary = await builder(opts.providerId);
  // Lane 5 — if a routing policy is active, wrap the resolved provider in a
  // RoutingProvider so each turn can dispatch to the policy-matched provider.
  let provider: LLMProvider = basePrimary;
  // Phase 14 tier2 — capture the most recent routing decision so each tool
  // call audit row records which model actually handled the turn.
  const routingTracker: RoutingDecisionTracker = { lastDecision: null };
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
        onDecision: (decision) => {
          routingTracker.lastDecision = decision;
        },
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
    turnStatus: 'streaming',
  });

  const history = listMessages(opts.conversationId);
  const messages: Message[] = expandStoredMessages(history.filter((m) => m.id !== assistantRow.id));

  const streamId = randomUUID();
  const controller = new AbortController();
  const activeEntry: ActiveStream = {
    controller,
    conversationId: opts.conversationId,
    assistantMessageId: assistantRow.id,
  };
  active.set(streamId, activeEntry);
  activeByConversation.set(opts.conversationId, activeEntry);

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
    routingTracker,
    autoTitle: opts.autoTitle ?? false,
  }).finally(() => {
    active.delete(streamId);
    if (activeByConversation.get(opts.conversationId) === activeEntry) {
      activeByConversation.delete(opts.conversationId);
    }
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
  routingTracker?: RoutingDecisionTracker;
  autoTitle: boolean;
}

interface RoutingDecisionTracker {
  lastDecision: RoutingDecision | null;
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
  let cachedInputTokens: number | null = null;
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

  // Crash-restore — throttled (leading + trailing) checkpoint of the in-flight
  // partial. Writes buffer + blocks WITHOUT flipping turn_status and WITHOUT
  // re-indexing FTS, so a hard crash mid-turn leaves the latest partial on disk.
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  let checkpointPendingTrailing = false;

  const writeCheckpoint = (): void => {
    try {
      const hasToolBlocks = allBlocks.some(
        (b) => b.type === 'tool_use' || b.type === 'tool_result',
      );
      updateAssistantMessage(args.assistantMessageId, {
        content: buffer,
        contentBlocks: hasToolBlocks ? allBlocks : null,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        costUsd,
        indexFts: false,
      });
    } catch (err) {
      logger.warn(
        { err, assistantMessageId: args.assistantMessageId },
        'chat checkpoint write failed',
      );
    }
  };

  const checkpoint = (): void => {
    if (checkpointTimer !== null) {
      // Within the throttle window — remember to flush once it elapses.
      checkpointPendingTrailing = true;
      return;
    }
    // Leading edge — write immediately, then open the window.
    writeCheckpoint();
    checkpointPendingTrailing = false;
    checkpointTimer = setTimeout(() => {
      checkpointTimer = null;
      if (checkpointPendingTrailing) {
        checkpointPendingTrailing = false;
        writeCheckpoint();
      }
    }, CHECKPOINT_MS);
  };

  const cancelCheckpointTimer = (): void => {
    if (checkpointTimer !== null) {
      clearTimeout(checkpointTimer);
      checkpointTimer = null;
    }
    checkpointPendingTrailing = false;
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
            checkpoint();
          } else if (event.type === 'tool_call') {
            iterToolCalls.push(event);
            emit(event);
          } else if (event.type === 'usage') {
            inputTokens = (inputTokens ?? 0) + event.inputTokens;
            outputTokens = (outputTokens ?? 0) + event.outputTokens;
            if (event.cachedInputTokens !== undefined) {
              cachedInputTokens = (cachedInputTokens ?? 0) + event.cachedInputTokens;
            }
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
        // On user cancel, persist whatever partial we have before the terminal
        // write flips turn_status to 'final'.
        checkpoint();
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
        checkpoint();
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
    // Terminal write — flips turn_status back to 'final' and re-indexes FTS.
    // This is the single authoritative persist; checkpoints above only ever
    // wrote partials with indexFts:false and never touched turn_status.
    cancelCheckpointTimer();
    try {
      const hasToolBlocks = allBlocks.some(
        (b) => b.type === 'tool_use' || b.type === 'tool_result',
      );
      updateAssistantMessage(args.assistantMessageId, {
        content: buffer,
        contentBlocks: hasToolBlocks ? allBlocks : null,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        costUsd,
        turnStatus: 'final',
      });
    } catch (err) {
      logger.error(
        { err, assistantMessageId: args.assistantMessageId },
        'failed to persist assistant message',
      );
    }
    // Best-effort: name a still-untitled conversation from its first exchange.
    // Fire-and-forget so it never delays stream teardown; failures are silent.
    if (args.autoTitle && !args.signal.aborted && buffer.trim().length > 0) {
      void autoTitleConversation({
        conversationId: args.conversationId,
        provider: args.provider,
        modelId: args.modelId,
        assistantText: buffer,
      });
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
  // Per-hunk partial accept: the user kept a strict subset of hunks at the gate.
  // The reconstructed content collapses to write_file{path, content} against the
  // SAME path, replacing the original tool. Re-check the write tier at the sink
  // (write_file's zod + resolveWithinWorkspace re-validate inside registry.execute,
  // the SECOND zod boundary). If the override is present but write_file is not a
  // write-tier tool, deny rather than silently downgrade.
  const override = outcome.override;
  if (override) {
    const writeTool = registry.get('write_file');
    if (!writeTool || writeTool.permissionTier !== 'write') {
      const output = `Partial-accept override rejected: write_file is not available as a write-tier tool`;
      auditToolCall(args, tc, { output, isError: true, decision: 'denied', durationMs: null });
      return { output, isError: true };
    }
  }
  const execName = override ? override.toolName : tc.name;
  const execArgs: unknown = override ? override.arguments : tc.arguments;
  const auditInput: unknown = override ? override.arguments : tc.arguments;

  // Unified checkpoint manager — capture the pre-image of every file this
  // mutating tool is about to touch BEFORE the edit lands. Per-turn scope,
  // keyed by assistantMessageId. Capture failures are logged + swallowed inside
  // captureBeforeMutation so they can never block the edit. run_shell is out of
  // scope (shell-side edits are not tracked). The override writes the SAME path,
  // so the original-tool pre-image capture remains valid — capture from tc.
  if (isMutatingTool(tc.name) && !args.signal.aborted) {
    await captureBeforeMutation({
      scope: 'turn',
      conversationId: args.conversationId,
      assistantMessageId: args.assistantMessageId,
      workspaceRoot: args.workspaceRoot,
      toolName: tc.name,
      args: tc.arguments,
    });
  }
  const startedAt = Date.now();
  const auditDecision = override ? 'prompt-allowed-partial' : outcomeToAuditDecision(outcome);
  try {
    const output = await registry.execute(execName, execArgs, {
      workspaceRoot: args.workspaceRoot,
      signal: args.signal,
      logger: {
        info: (msg, meta) => logger.info({ tool: execName, meta }, msg),
        error: (msg, meta) => logger.error({ tool: execName, meta }, msg),
      },
    });
    // Lane 6 — record diff-producing tool calls for replay / provenance.
    if (isDiffProducingTool(execName) && !args.signal.aborted) {
      try {
        const argsRecord = (execArgs ?? {}) as Record<string, unknown>;
        const filePath = typeof argsRecord.path === 'string' ? argsRecord.path : '<unknown>';
        const diffText = buildDiffSummaryFromToolCall(execName, argsRecord, output);
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
          { err, tool: execName, streamId: args.streamId },
          'failed to record applied diff',
        );
      }
    }
    auditToolCall(args, tc, {
      input: auditInput,
      output,
      isError: false,
      decision: auditDecision,
      durationMs: Date.now() - startedAt,
    });
    return { output, isError: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, tool: execName, streamId: args.streamId }, 'tool execution failed');
    auditToolCall(args, tc, {
      input: auditInput,
      output: msg,
      isError: true,
      decision: auditDecision,
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
  // When a per-hunk partial override executed, the recorded input is the
  // override's write_file args (so the audit reflects what actually ran).
  input?: unknown;
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
      input: patch.input !== undefined ? patch.input : tc.arguments,
      output: patch.output,
      decision: patch.decision,
      isError: patch.isError,
      durationMs: patch.durationMs,
      routingDecision: args.routingTracker?.lastDecision ?? null,
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
