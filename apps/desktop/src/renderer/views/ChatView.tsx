import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AddToMemoryButton } from '../components/AddToMemoryButton';
import { ArtifactPanel } from '../components/ArtifactPanel';
import { pickLatestArtifact } from '../components/extract-artifacts';
import { useCollapseState } from '../state/use-collapse-state';
import { CheckpointRestoreButton } from '../components/CheckpointRestoreButton';
import { ChatBudgetOverride } from '../components/ChatBudgetOverride';
import { CloudProviderTip } from '../components/CloudProviderTip';
import { ModelPicker } from '../components/ModelPicker';
import { ProviderSwitchButton } from '../components/ProviderSwitchButton';
import { ReplayConversationModal } from '../components/ReplayConversationModal';
import { VoiceInputButton } from '../components/VoiceInputButton';
import type { ContentBlock } from '@opencodex/core';
import {
  extractFilePathsFromMessages,
  lastUserMessageText,
} from '../components/extract-file-paths';
import { splitThinkingSegments } from '../components/extract-thinking';
import { HoverHint } from '../components/HoverHint';
import { Markdown } from '../components/Markdown';
import { MentionPicker } from '../components/MentionPicker';
import { SlashCommands } from '../components/SlashCommands';
import { useToast } from '../components/Toasts';
import {
  applyInsert,
  buildSlashGroups,
  findSkillsForTriggerText,
  formatPluginCommandInsert,
  formatPromptInsert,
  formatSkillInsert,
  getSlashTrigger,
  type SlashCommandTrigger,
} from '../components/slash-commands';
import {
  buildMentionGroups,
  getMentionTrigger,
  removeMentionToken,
  selectableMentionEntries,
  type MentionTrigger,
} from '../components/mention-picker';
import type { CodebaseSearchHit } from '../../shared/codebase-search';
import { ToolCallCard } from '../components/ToolCallCard';
import { groupContentBlocks } from '../components/tool-block-grouping';
import { useChat, type AssistantDraft, type QueuedMessage } from '../state/chat-context';
import { useComposerDraft } from '../state/use-composer-draft';
import { useSelectedModel } from '../state/selected-model-context';
import { consumeTransfer, pushTransfer, useTransferPending } from '../state/transfer';
import type { ChatAttachment } from '../../shared/attachments';
import type {
  ConversationExportFormat,
  ConversationUsage,
  StoredMessage,
} from '../../shared/conversation';
import type { McpPromptEntry } from '../../shared/mcp';
import type { PluginSlashCommandDescriptor } from '../../shared/plugins';
import type { Skill } from '../../shared/skills';

export function ChatView(): JSX.Element {
  const { selected, selectedCapabilities, loading: modelLoading } = useSelectedModel();
  const chat = useChat();
  const { activeId: chatActiveId, selectConversation, createConversation } = chat;
  const [searchParams, setSearchParams] = useSearchParams();
  const urlConversationId = searchParams.get('conversationId');
  const urlMessageId = searchParams.get('messageId');
  const transfer = useTransferPending();
  const [seededInput, setSeededInput] = useState<string | null>(null);
  const [transferOrigin, setTransferOrigin] = useState<'agent' | 'codebase' | null>(null);

  useEffect(() => {
    if (!urlConversationId) return;
    if (chatActiveId === urlConversationId) return;
    selectConversation(urlConversationId);
  }, [urlConversationId, chatActiveId, selectConversation]);

  // Handle inbound transfers from the agent / codebase views.
  useEffect(() => {
    if (!transfer) return;
    if (transfer.kind === 'agent-to-chat') {
      const ctx = transfer;
      consumeTransfer();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTransferOrigin('agent');
      void (async () => {
        const created = await createConversation(
          selected?.providerId ?? null,
          selected?.modelId ?? null,
        );
        try {
          await window.opencodex.conversations.appendMessage({
            conversationId: created.id,
            role: 'system',
            content: `Continuing from subagent run.\n\n${ctx.summary}`,
          });
        } catch {
          // Not fatal — the conversation still exists; user can re-send.
        }
        selectConversation(created.id);
      })();
    } else if (transfer.kind === 'codebase-to-chat') {
      const ctx = transfer;
      consumeTransfer();
      setTransferOrigin('codebase');
      void (async () => {
        const created = await createConversation(
          selected?.providerId ?? null,
          selected?.modelId ?? null,
        );
        selectConversation(created.id);
        setSeededInput(`Re: ${ctx.filePath}\n\n`);
      })();
    }
  }, [transfer, createConversation, selectConversation, selected]);

  return (
    <section className="chat-layout">
      <div className="chat-main">
        {modelLoading ? (
          <div className="chat-empty-center">
            <p className="chat-empty">Loading…</p>
          </div>
        ) : !selected ? (
          <div className="chat-empty-center">
            <p className="chat-empty">
              Pick a model in the top bar, or{' '}
              <Link to="/settings">add a provider API key in Settings</Link>.
            </p>
          </div>
        ) : !selectedCapabilities ? (
          <div className="chat-empty-center">
            <p className="chat-warn chat-warn-box">
              The previously selected model (<code>{selected.providerId}</code> ·{' '}
              <code>{selected.modelId}</code>) isn&apos;t available. Pick another in the top bar.
            </p>
          </div>
        ) : (
          <ChatPane
            providerId={selected.providerId}
            modelId={selected.modelId}
            modelName={selectedCapabilities.displayName}
            supportsTools={selectedCapabilities.toolUse}
            chat={chat}
            scrollToMessageId={urlMessageId}
            scrollToConversationId={urlConversationId}
            seededInput={seededInput}
            transferOrigin={transferOrigin}
            onConsumedSeededInput={() => setSeededInput(null)}
            onClearTransferOrigin={() => setTransferOrigin(null)}
            onConsumeScrollTarget={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('messageId');
              next.delete('conversationId');
              setSearchParams(next, { replace: true });
            }}
          />
        )}
      </div>
    </section>
  );
}

interface ChatPaneProps {
  providerId: string;
  modelId: string;
  modelName: string;
  supportsTools: boolean;
  chat: ReturnType<typeof useChat>;
  scrollToMessageId: string | null;
  scrollToConversationId: string | null;
  seededInput?: string | null;
  transferOrigin?: 'agent' | 'codebase' | null;
  onConsumedSeededInput?: () => void;
  onClearTransferOrigin?: () => void;
  onConsumeScrollTarget: () => void;
}

const STARTER_CHIPS: ReadonlyArray<{ label: string; prompt: string }> = [
  {
    label: 'Explain this repo',
    prompt: 'Explain this repository: its purpose, layout, and how the pieces fit together.',
  },
  {
    label: 'Find TODOs in src/',
    prompt: 'Find all TODO and FIXME comments under src/ and group them by file.',
  },
  { label: 'Run the test suite', prompt: 'Run the project test suite and summarise any failures.' },
];

function ChatPane({
  providerId,
  modelId,
  modelName,
  supportsTools,
  chat,
  scrollToMessageId,
  scrollToConversationId,
  seededInput,
  transferOrigin,
  onConsumedSeededInput,
  onClearTransferOrigin,
  onConsumeScrollTarget,
}: ChatPaneProps): JSX.Element {
  const navigate = useNavigate();
  const {
    input,
    setInput,
    attachments,
    setAttachments,
    clear: clearComposerDraft,
  } = useComposerDraft(chat.activeId);
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [mcpPrompts, setMcpPrompts] = useState<McpPromptEntry[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [pluginCommands, setPluginCommands] = useState<PluginSlashCommandDescriptor[]>([]);
  const [slashTrigger, setSlashTrigger] = useState<SlashCommandTrigger | null>(null);
  const [branching, setBranching] = useState(false);
  const toast = useToast();
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  // @-mention context picker — a parallel, independent set mirroring the slash
  // machinery so the two triggers never fight.
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [mentionHits, setMentionHits] = useState<CodebaseSearchHit[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [debouncedInput, setDebouncedInput] = useState('');
  const [dismissedHintSkillIds, setDismissedHintSkillIds] = useState<Set<string>>(new Set());
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preparingAttachments, setPreparingAttachments] = useState(false);
  // Lane 6 — replay-this-conversation modal
  const [replayModalOpen, setReplayModalOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const consumedScrollRef = useRef<Set<string>>(new Set());
  const skipBottomScrollRef = useRef(false);
  const { messages: chatMessages, draft: chatDraft, activeId: chatActiveId } = chat;

  useEffect(() => {
    let cancelled = false;
    void window.opencodex.workspace
      .get()
      .then((s) => {
        if (!cancelled) setActiveWorkspace(s.active);
      })
      .catch(() => {
        // Banner is an advisory affordance; ignore load errors.
      });
    const off = window.opencodex.workspace.onChanged((payload) => {
      if (!cancelled) setActiveWorkspace(payload.state.active);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void window.opencodex.mcp
        .listPrompts()
        .then((rows) => {
          if (!cancelled) setMcpPrompts(rows);
        })
        .catch(() => {
          // Slash menu degrades gracefully when prompts can't load.
        });
    };
    refresh();
    const off = window.opencodex.mcp.onChanged(() => refresh());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void window.opencodex.skills
        .list()
        .then((res) => {
          if (!cancelled) setSkills(res.skills);
        })
        .catch(() => {
          // ignore — skills are optional
        });
    };
    refresh();
    const off = window.opencodex.skills.onChanged((payload) => {
      if (!cancelled) setSkills(payload.skills);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void window.opencodex.plugins
        .listSlashCommands()
        .then((rows) => {
          if (!cancelled) setPluginCommands(rows);
        })
        .catch(() => {
          // Slash menu degrades gracefully when plugin commands can't load.
        });
    };
    refresh();
    const off = window.opencodex.plugins.onChanged(() => refresh());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // Lane 3 — react to inline scroll-to-message events from CommandPalette etc.
  useEffect(() => {
    const off = window.opencodex.conversations.onScrollToMessage((payload) => {
      if (payload.conversationId !== chatActiveId) return;
      const el = document.getElementById(`chat-message-${payload.messageId}`);
      if (!el) return;
      consumedScrollRef.current.add(payload.messageId);
      skipBottomScrollRef.current = true;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('chat-bubble-highlight');
      window.setTimeout(() => el.classList.remove('chat-bubble-highlight'), 2000);
    });
    return () => off();
  }, [chatActiveId]);

  useLayoutEffect(() => {
    if (!scrollToMessageId) return;
    if (consumedScrollRef.current.has(scrollToMessageId)) return;
    if (scrollToConversationId && chatActiveId !== scrollToConversationId) return;
    if (!chatMessages.some((m) => m.id === scrollToMessageId)) return;
    const el = document.getElementById(`chat-message-${scrollToMessageId}`);
    if (!el) return;
    consumedScrollRef.current.add(scrollToMessageId);
    skipBottomScrollRef.current = true;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('chat-bubble-highlight');
    const t = window.setTimeout(() => {
      el.classList.remove('chat-bubble-highlight');
    }, 2000);
    onConsumeScrollTarget();
    return () => window.clearTimeout(t);
  }, [
    scrollToMessageId,
    scrollToConversationId,
    chatActiveId,
    chatMessages,
    onConsumeScrollTarget,
  ]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const cs = window.getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 20;
    const minPx = parseFloat(cs.minHeight) || 120;
    const maxPx = lineHeight * 12 + 24;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minPx), maxPx)}px`;
  }, [input]);

  useLayoutEffect(() => {
    if (skipBottomScrollRef.current) {
      skipBottomScrollRef.current = false;
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages, chatDraft]);

  const slashGroups = useMemo(
    () =>
      slashTrigger ? buildSlashGroups(mcpPrompts, skills, slashTrigger.query, pluginCommands) : [],
    [slashTrigger, mcpPrompts, skills, pluginCommands],
  );
  const flatSlashEntries = useMemo(() => slashGroups.flatMap((g) => g.entries), [slashGroups]);
  const slashOpen = slashTrigger !== null;

  const mentionGroups = useMemo(
    () => (mentionTrigger ? buildMentionGroups(mentionHits, mentionTrigger.query) : []),
    [mentionTrigger, mentionHits],
  );
  const flatMentionEntries = useMemo(
    () => selectableMentionEntries(mentionGroups),
    [mentionGroups],
  );
  const mentionOpen = mentionTrigger !== null;

  // Debounced file+folder search scoped to the active workspace. Mirrors the
  // CodebaseSearchBox debounce; results feed the @-mention dropdown only.
  const mentionReqRef = useRef(0);
  const mentionQuery = mentionTrigger?.query ?? null;
  useEffect(() => {
    const trimmed = mentionQuery === null ? '' : mentionQuery.trim();
    if (mentionQuery === null || !activeWorkspace || trimmed.length === 0) {
      mentionReqRef.current++;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMentionHits([]);
      setMentionLoading(false);
      return;
    }
    const reqId = ++mentionReqRef.current;
    setMentionLoading(true);
    const handle = window.setTimeout(() => {
      void window.opencodex.codebase
        .search({ workspaceRoot: activeWorkspace, query: trimmed, mode: 'filename' })
        .then((res) => {
          if (mentionReqRef.current !== reqId) return;
          setMentionHits(res.hits);
        })
        .catch(() => {
          if (mentionReqRef.current !== reqId) return;
          setMentionHits([]);
        })
        .finally(() => {
          if (mentionReqRef.current === reqId) setMentionLoading(false);
        });
    }, 200);
    return () => window.clearTimeout(handle);
  }, [mentionQuery, activeWorkspace]);

  const [lastSent, setLastSent] = useState<{ text: string; attachments: ChatAttachment[] } | null>(
    null,
  );

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (slashOpen || mentionOpen) return;
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;
    if (preparingAttachments) return;
    const sent = attachments;
    // Mid-stream submissions queue as the next FIFO turn rather than starting a
    // second concurrent stream; the composer still clears so the user can type more.
    if (chat.streaming) {
      chat.enqueue({ providerId, model: modelId, text: trimmed, attachments: sent });
      clearComposerDraft();
      setAttachmentError(null);
      return;
    }
    clearComposerDraft();
    setAttachmentError(null);
    setLastSent({ text: trimmed, attachments: sent });
    onClearTransferOrigin?.();
    void chat.send({
      providerId,
      modelId,
      userMessage: trimmed,
      ...(sent.length > 0 ? { attachments: sent } : {}),
    });
  };

  const handleRetry = (): void => {
    if (chat.streaming) return;
    if (!lastSent) {
      const recovered = lastUserMessageText(chat.messages);
      if (!recovered) return;
      void chat.send({ providerId, modelId, userMessage: recovered });
      return;
    }
    void chat.send({
      providerId,
      modelId,
      userMessage: lastSent.text,
      ...(lastSent.attachments.length > 0 ? { attachments: lastSent.attachments } : {}),
    });
  };

  const handleStarterChip = (prompt: string): void => {
    setInput(prompt);
    const el = inputRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(prompt.length, prompt.length);
      });
    }
  };

  const ingestDroppedPaths = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return;
    setPreparingAttachments(true);
    setAttachmentError(null);
    try {
      const result = await window.opencodex.attachments.prepare({ paths });
      if (result.prepared.length > 0) {
        setAttachments((prev) => [...prev, ...result.prepared]);
      }
      if (result.errors.length > 0) {
        setAttachmentError(
          result.errors.map((e) => `${e.path.split(/[\\/]/).pop()}: ${e.message}`).join('; '),
        );
      }
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreparingAttachments(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    const paths: string[] = [];
    for (const file of files) {
      const filePath = (file as File & { path?: string }).path;
      if (typeof filePath === 'string' && filePath.length > 0) paths.push(filePath);
    }
    if (paths.length > 0) void ingestDroppedPaths(paths);
  };

  const handleDragOver = (e: React.DragEvent<HTMLFormElement>): void => {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!dragOver) setDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLFormElement>): void => {
    if (e.currentTarget === e.target) setDragOver(false);
  };

  const removeAttachment = (index: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const closeSlash = (): void => {
    setSlashTrigger(null);
    setSlashActiveIndex(0);
  };

  const closeMention = (): void => {
    setMentionTrigger(null);
    setMentionActiveIndex(0);
    mentionReqRef.current++;
    setMentionHits([]);
    setMentionLoading(false);
  };

  const consumeMentionToken = (): void => {
    if (!mentionTrigger) return;
    const el = inputRef.current;
    const caret = el ? (el.selectionEnd ?? input.length) : input.length;
    const next = removeMentionToken(input, mentionTrigger, caret);
    setInput(next.value);
    closeMention();
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      });
    }
  };

  const selectMentionFile = (hit: CodebaseSearchHit): void => {
    if (!activeWorkspace) {
      consumeMentionToken();
      return;
    }
    const abs = joinWorkspacePath(activeWorkspace, hit.path);
    consumeMentionToken();
    setPreparingAttachments(true);
    setAttachmentError(null);
    void window.opencodex.attachments
      .prepare({ paths: [abs] })
      .then((result) => {
        if (result.prepared.length > 0) {
          setAttachments((prev) => [...prev, ...result.prepared]);
        }
        if (result.errors.length > 0) {
          setAttachmentError(
            result.errors.map((e) => `${e.path.split(/[\\/]/).pop()}: ${e.message}`).join('; '),
          );
        }
      })
      .catch((err: unknown) => {
        setAttachmentError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setPreparingAttachments(false));
  };

  const selectMentionFolder = (hit: CodebaseSearchHit): void => {
    if (!activeWorkspace) {
      consumeMentionToken();
      return;
    }
    const workspaceRoot = activeWorkspace;
    consumeMentionToken();
    setPreparingAttachments(true);
    setAttachmentError(null);
    void window.opencodex.codebase
      .listDirFiles({ workspaceRoot, path: hit.path })
      .then(async (listing) => {
        if (listing.files.length === 0) return;
        const paths = listing.files.map((rel) => joinWorkspacePath(workspaceRoot, rel));
        const result = await window.opencodex.attachments.prepare({ paths });
        if (result.prepared.length > 0) {
          setAttachments((prev) => [...prev, ...result.prepared]);
        }
        const notes: string[] = [];
        if (result.errors.length > 0) {
          notes.push(
            result.errors.map((e) => `${e.path.split(/[\\/]/).pop()}: ${e.message}`).join('; '),
          );
        }
        if (listing.truncated) {
          notes.push(`${hit.path}/ truncated to first ${listing.files.length} files`);
        }
        if (notes.length > 0) setAttachmentError(notes.join('; '));
      })
      .catch((err: unknown) => {
        setAttachmentError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setPreparingAttachments(false));
  };

  const insertPrompt = (entry: McpPromptEntry): void => {
    if (!slashTrigger) return;
    const el = inputRef.current;
    const caret = el ? (el.selectionEnd ?? input.length) : input.length;
    const insert = formatPromptInsert(entry);
    const next = applyInsert(input, slashTrigger, caret, insert);
    setInput(next.value);
    closeSlash();
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      });
    }
  };

  const insertSkill = (skill: Skill): void => {
    if (!slashTrigger) return;
    const el = inputRef.current;
    const caret = el ? (el.selectionEnd ?? input.length) : input.length;
    const insert = formatSkillInsert(skill);
    const next = applyInsert(input, slashTrigger, caret, insert);
    setInput(next.value);
    closeSlash();
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      });
    }
  };

  const insertPluginCommand = (command: PluginSlashCommandDescriptor): void => {
    if (!slashTrigger) return;
    const el = inputRef.current;
    const caret = el ? (el.selectionEnd ?? input.length) : input.length;
    const insert = formatPluginCommandInsert(command);
    const next = applyInsert(input, slashTrigger, caret, insert);
    setInput(next.value);
    closeSlash();
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      });
    }
    void window.opencodex.plugins
      .runSlashCommand({ pluginId: command.pluginId, name: command.name, args: '' })
      .then((res) => {
        if (!res.ok) {
          toast.show(`/${command.name} failed: ${res.error}`, { kind: 'error' });
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.show(`/${command.name} failed: ${message}`, { kind: 'error' });
      });
  };

  // Inline "Try /<skill>" hint — debounced 300ms; substring match against
  // skill.triggers[]. Suppressed when the composer already starts with a slash.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedInput(input);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [input]);

  const triggerHintSkill = useMemo<Skill | null>(() => {
    if (input.startsWith('/') || input.length === 0) return null;
    if (debouncedInput.length === 0 || debouncedInput.startsWith('/')) return null;
    const matches = findSkillsForTriggerText(skills, debouncedInput);
    return matches.find((s) => !dismissedHintSkillIds.has(s.id)) ?? null;
  }, [input, debouncedInput, skills, dismissedHintSkillIds]);

  const dismissTriggerHint = (): void => {
    if (!triggerHintSkill) return;
    const id = triggerHintSkill.id;
    setDismissedHintSkillIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const applyTriggerHint = (): void => {
    if (!triggerHintSkill) return;
    const insert = formatSkillInsert(triggerHintSkill);
    const next = `${insert}${input.length > 0 ? '\n' + input : ''}`;
    setInput(next);
    const el = inputRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(insert.length, insert.length);
      });
    }
  };

  const updateSlashFromCaret = (value: string, caret: number): void => {
    const trigger = getSlashTrigger(value, caret);
    setSlashTrigger(trigger);
    if (!trigger) setSlashActiveIndex(0);
  };

  const updateMentionFromCaret = (value: string, caret: number): void => {
    const trigger = getMentionTrigger(value, caret);
    setMentionTrigger(trigger);
    if (!trigger) {
      setMentionActiveIndex(0);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value;
    setInput(next);
    const caret = e.target.selectionEnd ?? next.length;
    updateSlashFromCaret(next, caret);
    updateMentionFromCaret(next, caret);
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    const el = e.currentTarget;
    const caret = el.selectionEnd ?? el.value.length;
    updateSlashFromCaret(el.value, caret);
    updateMentionFromCaret(el.value, caret);
  };

  const openSlashMenuManually = (): void => {
    const el = inputRef.current;
    const caret = el ? (el.selectionEnd ?? input.length) : input.length;
    const before = input.slice(0, caret);
    const after = input.slice(caret);
    const needsNewline = before.length > 0 && !before.endsWith('\n');
    const insert = `${needsNewline ? '\n' : ''}/`;
    const next = before + insert + after;
    const nextCaret = before.length + insert.length;
    setInput(next);
    setSlashTrigger({ query: '', start: nextCaret - 1 });
    setSlashActiveIndex(0);
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSlashMenuManually();
      return;
    }
    if (slashOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSlash();
        return;
      }
      if (flatSlashEntries.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashActiveIndex((i) => (i + 1) % flatSlashEntries.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashActiveIndex((i) => (i - 1 + flatSlashEntries.length) % flatSlashEntries.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const idx = Math.min(slashActiveIndex, flatSlashEntries.length - 1);
          const entry = flatSlashEntries[idx];
          if (entry) {
            if (entry.kind === 'mcp') insertPrompt(entry.entry);
            else if (entry.kind === 'skill') insertSkill(entry.skill);
            else insertPluginCommand(entry.command);
          }
          return;
        }
      }
    }
    if (mentionOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMention();
        return;
      }
      if (flatMentionEntries.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionActiveIndex((i) => (i + 1) % flatMentionEntries.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionActiveIndex(
            (i) => (i - 1 + flatMentionEntries.length) % flatMentionEntries.length,
          );
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const idx = Math.min(mentionActiveIndex, flatMentionEntries.length - 1);
          const entry = flatMentionEntries[idx];
          if (entry) {
            if (entry.kind === 'file') selectMentionFile(entry.hit);
            else if (entry.kind === 'folder') selectMentionFolder(entry.hit);
          }
          return;
        }
      }
    }
    if (e.key === 'Escape' && chat.streaming) {
      e.preventDefault();
      void chat.cancel();
      return;
    }
    if (e.key === 'ArrowUp' && input.length === 0 && !chat.streaming) {
      const recovered = lastUserMessageText(chat.messages);
      if (recovered) {
        e.preventDefault();
        setInput(recovered);
        const len = recovered.length;
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el) el.setSelectionRange(len, len);
        });
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Stable ref so memoized <MessageBubble /> children don't re-render on every
  // streaming text_delta. Without this, ChatPane's re-render on each delta
  // would invalidate the memo via prop identity change.
  const handleRerun = useCallback(
    (prompt: string): void => {
      setInput(prompt);
      const el = inputRef.current;
      if (el) {
        el.focus();
        const len = prompt.length;
        el.setSelectionRange(len, len);
      }
    },
    [setInput],
  );

  // Refs keep handleRegenerate identity stable across streaming deltas so the
  // memoized <MessageBubble /> children don't re-render (same rationale as the
  // handleRerun comment above). Synced in an effect — never written during render.
  const messagesRef = useRef(chat.messages);
  const sendRef = useRef(chat.send);
  const streamingRef = useRef(chat.streaming);
  useEffect(() => {
    messagesRef.current = chat.messages;
    sendRef.current = chat.send;
    streamingRef.current = chat.streaming;
  });

  // Regenerate an assistant reply by re-issuing the user turn that preceded it.
  const handleRegenerate = useCallback(
    (assistantId: string): void => {
      if (streamingRef.current) return;
      const msgs = messagesRef.current;
      const idx = msgs.findIndex((m) => m.id === assistantId);
      if (idx < 0) return;
      let userText = '';
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (msgs[i]?.role === 'user') {
          userText = msgs[i]?.content ?? '';
          break;
        }
      }
      if (userText.trim().length === 0) return;
      void sendRef.current({ providerId, modelId, userMessage: userText });
    },
    [providerId, modelId],
  );

  const visibleMessages = chat.draft
    ? chat.messages.filter((m) => m.id !== chat.draft?.messageId)
    : chat.messages;

  // Artifacts — live preview of the latest previewable block (html/svg/markdown)
  // an assistant produced, shown in a collapsible right-side panel.
  const artifact = useMemo(
    () =>
      pickLatestArtifact(
        visibleMessages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
      ),
    [visibleMessages],
  );
  const [artifactCollapsed, , setArtifactCollapsed] = useCollapseState('artifact-panel', false);
  const showArtifact = artifact !== null && !artifactCollapsed;

  const streamWorkspaceRoot = chat.streamWorkspaceRoot;
  const showWorkspaceMismatch =
    chat.streaming &&
    streamWorkspaceRoot !== null &&
    activeWorkspace !== null &&
    activeWorkspace !== streamWorkspaceRoot;

  const [lastAppliedSeed, setLastAppliedSeed] = useState<string | null>(null);

  useEffect(() => {
    if (!seededInput || seededInput === lastAppliedSeed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastAppliedSeed(seededInput);
    setInput(seededInput);
  }, [seededInput, lastAppliedSeed, setInput]);

  useEffect(() => {
    if (!seededInput || seededInput !== lastAppliedSeed) return;
    onConsumedSeededInput?.();
    const seedLen = seededInput.length;
    const handle = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(seedLen, seedLen);
    });
    return () => cancelAnimationFrame(handle);
  }, [seededInput, lastAppliedSeed, onConsumedSeededInput]);

  const handleSendToAgent = useCallback((): void => {
    if (!chat.activeId) return;
    const lastUser = lastUserMessageText(chat.messages);
    const taskSeed =
      lastUser.trim().length > 0
        ? lastUser
        : (chat.messages[chat.messages.length - 1]?.content ?? '');
    pushTransfer({
      kind: 'chat-to-agent',
      conversationId: chat.activeId,
      lastUserMessage: taskSeed,
      workspaceRoot: activeWorkspace ?? '',
    });
    navigate('/agent');
  }, [chat.activeId, chat.messages, activeWorkspace, navigate]);

  const handleSendToCodebase = useCallback((): void => {
    const filePaths = extractFilePathsFromMessages(chat.messages, { assistantOnly: true });
    pushTransfer({
      kind: 'chat-to-codebase',
      filePaths,
      workspaceRoot: activeWorkspace ?? '',
    });
    navigate('/codebase');
  }, [chat.messages, activeWorkspace, navigate]);

  return (
    <div className="chat-pane">
      <h1 className="sr-only">Chat</h1>
      <header className="chat-header">
        <div className="chat-header-title">{modelName}</div>
        <UsageSummary usage={chat.usage} />
        <ChatBudgetOverride conversationId={chat.activeId} disabled={chat.streaming} />
        <ProviderSwitchButton
          conversationId={chat.activeId}
          disabled={chat.streaming}
          onSwitched={({ providerId, modelId, resendStrategy, summary }) => {
            if (resendStrategy === 'summary-only' && summary && chat.activeId) {
              void window.opencodex.conversations.appendMessage({
                conversationId: chat.activeId,
                role: 'system',
                content: summary,
                providerId,
                modelId,
              });
            }
          }}
        />
        <div className="chat-header-actions">
          <div className="chat-header-transfer">
            <button
              type="button"
              className="btn"
              disabled={!chat.activeId || chat.streaming}
              onClick={handleSendToAgent}
              title="Hand the conversation to the Agent view as a new autonomous run"
            >
              Send to Agent
            </button>
            <button
              type="button"
              className="btn"
              disabled={!chat.activeId}
              onClick={handleSendToCodebase}
              title="Open the Codebase view with file paths mentioned in this chat"
            >
              Send to Codebase
            </button>
          </div>
          <div className="chat-header-actions-secondary">
            {/* Lane 9 — Branch from this conversation */}
            <button
              type="button"
              className="btn"
              disabled={!chat.activeId || branching}
              onClick={() => {
                if (!chat.activeId || branching) return;
                setBranching(true);
                void window.opencodex.git
                  .branchFromConversation({ conversationId: chat.activeId })
                  .then((res) => {
                    if (res.ok) {
                      toast.show(res.branch ? `Created branch ${res.branch}` : 'Branch created', {
                        kind: 'success',
                      });
                    } else {
                      toast.show(res.error ?? 'Failed to create branch', { kind: 'error' });
                    }
                  })
                  .catch((err: unknown) => {
                    toast.show(err instanceof Error ? err.message : String(err), { kind: 'error' });
                  })
                  .finally(() => setBranching(false));
              }}
              title="Create an oc/<slug> branch in the active workspace from this conversation"
            >
              {branching ? 'Branching…' : 'Branch'}
            </button>
            {/* Lane 6 — replay this conversation against a different provider/model */}
            <button
              type="button"
              className="btn"
              disabled={!chat.activeId || chat.streaming}
              onClick={() => setReplayModalOpen(true)}
              title="Replay this conversation against a different provider/model and diff the outputs"
            >
              Replay
            </button>
            <ExportMenu
              disabled={!chat.activeId || chat.streaming}
              onExport={(fmt) => {
                void chat.exportActive(fmt);
              }}
            />
            {artifact ? (
              <button
                type="button"
                className="btn"
                onClick={() => setArtifactCollapsed(showArtifact)}
                title="Toggle live preview of the latest generated artifact"
                aria-pressed={showArtifact}
              >
                {showArtifact ? 'Hide preview' : 'Preview'}
              </button>
            ) : null}
          </div>
        </div>
        {chat.error ? <div className="chat-error">{chat.error}</div> : null}
        {!chat.streaming &&
        chat.activeId !== null &&
        chat.interruptedConversationId === chat.activeId ? (
          <div className="chat-interrupted" role="status">
            <span className="chat-interrupted-label">Interrupted — response was cut off.</span>{' '}
            <button type="button" className="chat-interrupted-retry" onClick={handleRetry}>
              Retry
            </button>
          </div>
        ) : null}
      </header>
      <div className="chat-body">
        <div className="chat-main-col">
          <div className="chat-scroll" ref={scrollRef}>
            {visibleMessages.length === 0 && !chat.draft ? (
              <div className="chat-empty-state">
                <p className="chat-empty-state-heading">What can I help you build?</p>
                <p className="chat-empty-state-sub">
                  Pick a starter below, or type your own question. Use{' '}
                  <kbd className="chat-empty-kbd">/</kbd> to insert a skill or MCP prompt, and{' '}
                  <kbd className="chat-empty-kbd">?</kbd> to see every shortcut.
                </p>
                <div className="chat-starter-chips">
                  {STARTER_CHIPS.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      className="chat-starter-chip"
                      onClick={() => handleStarterChip(chip.prompt)}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div
                className="chat-messages"
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
                aria-atomic="false"
                aria-label="Chat conversation"
              >
                {visibleMessages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    onRerun={handleRerun}
                    onRegenerate={handleRegenerate}
                    onEdit={handleRerun}
                  />
                ))}
                {chat.draft ? <DraftBubble draft={chat.draft} onRerun={handleRerun} /> : null}
              </div>
            )}
          </div>
          {showWorkspaceMismatch ? (
            <div className="chat-workspace-banner" role="status">
              <span className="chat-workspace-banner-label">Workspace changed mid-chat.</span>{' '}
              <span className="chat-workspace-banner-body">
                This response is still running against{' '}
                <code className="chat-workspace-banner-path">{streamWorkspaceRoot}</code>. The next
                message will use{' '}
                <code className="chat-workspace-banner-path">{activeWorkspace}</code>.
              </span>
            </div>
          ) : null}
          <form
            className={dragOver ? 'chat-composer drag-over' : 'chat-composer'}
            onSubmit={handleSubmit}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            {/* Lane 8 — Cloud provider trust tip; self-suppresses for ollama / once dismissed */}
            <CloudProviderTip providerId={providerId} providerDisplayName={modelName} />
            {chat.queued.length > 0 ? (
              <QueueStrip queued={chat.queued} onRemove={chat.removeQueued} />
            ) : null}
            {attachments.length > 0 || preparingAttachments || attachmentError ? (
              <div className="chat-attachments">
                {attachments.map((att, i) => (
                  <AttachmentChip
                    key={`${att.path}-${i}`}
                    attachment={att}
                    onRemove={() => removeAttachment(i)}
                  />
                ))}
                {preparingAttachments ? (
                  <span className="chat-attachment-loading">Preparing files…</span>
                ) : null}
                {attachmentError ? (
                  <span className="chat-attachment-error">{attachmentError}</span>
                ) : null}
              </div>
            ) : null}
            <div className="chat-input-wrap">
              {slashTrigger !== null ? (
                <SlashCommands
                  query={slashTrigger.query}
                  prompts={mcpPrompts}
                  skills={skills}
                  pluginCommands={pluginCommands}
                  activeIndex={Math.min(slashActiveIndex, Math.max(0, flatSlashEntries.length - 1))}
                  onSelectMcp={insertPrompt}
                  onSelectSkill={insertSkill}
                  onSelectPlugin={insertPluginCommand}
                  onActiveIndexChange={setSlashActiveIndex}
                  onClose={closeSlash}
                />
              ) : null}
              {mentionTrigger !== null ? (
                !activeWorkspace ? (
                  <div className="slash-commands slash-commands-empty" role="listbox">
                    <div className="slash-commands-empty-text">
                      Pick a workspace to mention files
                    </div>
                  </div>
                ) : (
                  <MentionPicker
                    query={mentionTrigger.query}
                    hits={mentionHits}
                    loading={mentionLoading}
                    activeIndex={Math.min(
                      mentionActiveIndex,
                      Math.max(0, flatMentionEntries.length - 1),
                    )}
                    onSelectFile={selectMentionFile}
                    onSelectFolder={selectMentionFolder}
                    onActiveIndexChange={setMentionActiveIndex}
                    onClose={closeMention}
                  />
                )
              ) : null}
              <textarea
                ref={inputRef}
                className="chat-input"
                aria-label="Message composer"
                value={input}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onSelect={handleSelect}
                onBlur={() => {
                  setTimeout(() => {
                    closeSlash();
                    closeMention();
                  }, 0);
                }}
                placeholder={composerPlaceholder(modelName, transferOrigin, chat.streaming)}
                rows={5}
                style={{ maxHeight: 'calc(1.5em * 12 + 24px)', overflowY: 'auto' }}
              />
            </div>
            {triggerHintSkill && !slashOpen ? (
              <div className="chat-skill-hint" role="status">
                <span>
                  Try{' '}
                  <button type="button" className="chat-skill-hint-link" onClick={applyTriggerHint}>
                    <code>/skill:{triggerHintSkill.name}</code>
                  </button>{' '}
                  for this
                </span>
                <HoverHint hint="Dismiss suggestion">
                  <button
                    type="button"
                    className="chat-skill-hint-dismiss"
                    onClick={dismissTriggerHint}
                    aria-label="Dismiss skill suggestion"
                  >
                    ×
                  </button>
                </HoverHint>
              </div>
            ) : null}
            <div className="chat-composer-actions">
              <div className="chat-composer-actions-left">
                <ComposerAddMenu
                  supportsTools={supportsTools}
                  toolsEnabled={toolsEnabled}
                  onToolsEnabledChange={setToolsEnabled}
                />
                <VoiceInputButton
                  disabled={chat.streaming}
                  onTranscript={(text) => {
                    setInput((prev) =>
                      prev.length > 0 && !prev.endsWith(' ') ? `${prev} ${text}` : `${prev}${text}`,
                    );
                    inputRef.current?.focus();
                  }}
                />
              </div>
              <div className="chat-composer-actions-right">
                <ModelPicker conversationId={chat.activeId} />
                {chat.streaming ? (
                  <>
                    <HoverHint hint="Stop streaming (Esc)">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          void chat.cancel();
                        }}
                      >
                        Stop
                      </button>
                    </HoverHint>
                    <HoverHint hint="Queue for next turn">
                      <button
                        type="submit"
                        className="btn btn-primary chat-send"
                        disabled={input.trim().length === 0 && attachments.length === 0}
                      >
                        Send
                      </button>
                    </HoverHint>
                  </>
                ) : chat.error && lastUserMessageText(chat.messages).length > 0 ? (
                  <HoverHint hint="Retry last message">
                    <button
                      type="button"
                      className="btn btn-primary chat-send"
                      onClick={handleRetry}
                    >
                      Retry
                    </button>
                  </HoverHint>
                ) : (
                  <HoverHint hint="Send message">
                    <button
                      type="submit"
                      className="btn btn-primary chat-send"
                      disabled={input.trim().length === 0 && attachments.length === 0}
                    >
                      Send
                    </button>
                  </HoverHint>
                )}
              </div>
            </div>
          </form>
        </div>
        {showArtifact ? (
          <ArtifactPanel artifact={artifact} onClose={() => setArtifactCollapsed(true)} />
        ) : null}
      </div>
      {replayModalOpen && chat.activeId ? (
        <ReplayConversationModal
          conversationId={chat.activeId}
          onClose={() => setReplayModalOpen(false)}
        />
      ) : null}
    </div>
  );
}

interface ComposerAddMenuProps {
  supportsTools: boolean;
  toolsEnabled: boolean;
  onToolsEnabledChange: (enabled: boolean) => void;
}

function ComposerAddMenu({
  supportsTools,
  toolsEnabled,
  onToolsEnabledChange,
}: ComposerAddMenuProps): JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const go = (path: string): void => {
    setOpen(false);
    navigate(path);
  };

  return (
    <div className="composer-add" ref={rootRef}>
      <HoverHint hint="Add tools, skills, MCPs, or plugins">
        <button
          type="button"
          className={open ? 'composer-add-btn open' : 'composer-add-btn'}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Add"
        >
          +
        </button>
      </HoverHint>
      {open ? (
        <div className="composer-add-pop" role="menu">
          {supportsTools ? (
            <label className="composer-add-row composer-add-row-toggle">
              <span className="composer-add-row-label">
                <span className="composer-add-icon" aria-hidden="true">
                  {/* tools wrench */}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    style={{ display: 'block', opacity: 0.8 }}
                  >
                    <mask
                      id="icon-tools"
                      style={{ maskType: 'alpha' }}
                      maskUnits="userSpaceOnUse"
                      x="0"
                      y="0"
                      width="16"
                      height="16"
                    >
                      <path
                        d="M10.5 1a4.5 4.5 0 0 0-4.27 5.9L1.22 11.9a1.5 1.5 0 1 0 2.12 2.12l5-5A4.5 4.5 0 0 0 14.5 4.5c0-.44-.06-.86-.17-1.27l-2.16 2.16-1.56-.44-.44-1.56 2.16-2.16A4.51 4.51 0 0 0 10.5 1Z"
                        fill="currentColor"
                      />
                    </mask>
                    <g mask="url(#icon-tools)">
                      <rect width="16" height="16" fill="currentColor" />
                    </g>
                  </svg>
                </span>
                Tools
              </span>
              <input
                type="checkbox"
                checked={toolsEnabled}
                onChange={(e) => onToolsEnabledChange(e.target.checked)}
              />
            </label>
          ) : (
            <div className="composer-add-row composer-add-row-disabled">
              <span className="composer-add-row-label">
                <span className="composer-add-icon" aria-hidden="true">
                  {/* tools wrench */}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    style={{ display: 'block', opacity: 0.8 }}
                  >
                    <mask
                      id="icon-tools-dis"
                      style={{ maskType: 'alpha' }}
                      maskUnits="userSpaceOnUse"
                      x="0"
                      y="0"
                      width="16"
                      height="16"
                    >
                      <path
                        d="M10.5 1a4.5 4.5 0 0 0-4.27 5.9L1.22 11.9a1.5 1.5 0 1 0 2.12 2.12l5-5A4.5 4.5 0 0 0 14.5 4.5c0-.44-.06-.86-.17-1.27l-2.16 2.16-1.56-.44-.44-1.56 2.16-2.16A4.51 4.51 0 0 0 10.5 1Z"
                        fill="currentColor"
                      />
                    </mask>
                    <g mask="url(#icon-tools-dis)">
                      <rect width="16" height="16" fill="currentColor" />
                    </g>
                  </svg>
                </span>
                Tools
              </span>
              <span className="composer-add-row-meta">Not supported</span>
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            className="composer-add-row"
            onClick={() => go('/settings/skills')}
          >
            <span className="composer-add-row-label">
              <span className="composer-add-icon" aria-hidden="true">
                {/* skills star */}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ display: 'block', opacity: 0.8 }}
                >
                  <mask
                    id="icon-skills"
                    style={{ maskType: 'alpha' }}
                    maskUnits="userSpaceOnUse"
                    x="0"
                    y="0"
                    width="16"
                    height="16"
                  >
                    <path
                      d="M8 1l1.8 3.64 4.02.58-2.91 2.84.69 4.01L8 10.1l-3.6 1.97.69-4.01L2.18 5.22l4.02-.58L8 1Z"
                      fill="currentColor"
                    />
                  </mask>
                  <g mask="url(#icon-skills)">
                    <rect width="16" height="16" fill="currentColor" />
                  </g>
                </svg>
              </span>
              Skills
            </span>
            <span className="composer-add-row-meta">Manage →</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="composer-add-row"
            onClick={() => go('/settings/mcp')}
          >
            <span className="composer-add-row-label">
              <span className="composer-add-icon" aria-hidden="true">
                {/* mcp chain links */}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ display: 'block', opacity: 0.8 }}
                >
                  <mask
                    id="icon-mcp"
                    style={{ maskType: 'alpha' }}
                    maskUnits="userSpaceOnUse"
                    x="0"
                    y="0"
                    width="16"
                    height="16"
                  >
                    <path
                      d="M6.5 9.5a3 3 0 0 0 4.24 0l2-2a3 3 0 0 0-4.24-4.24l-1.15 1.14M9.5 6.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 0 0 4.24 4.24l1.14-1.14"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </mask>
                  <g mask="url(#icon-mcp)">
                    <rect width="16" height="16" fill="currentColor" />
                  </g>
                </svg>
              </span>
              MCPs
            </span>
            <span className="composer-add-row-meta">Manage →</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="composer-add-row"
            onClick={() => go('/settings/plugins')}
          >
            <span className="composer-add-row-label">
              <span className="composer-add-icon" aria-hidden="true">
                {/* plugins puzzle piece */}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ display: 'block', opacity: 0.8 }}
                >
                  <mask
                    id="icon-plugins"
                    style={{ maskType: 'alpha' }}
                    maskUnits="userSpaceOnUse"
                    x="0"
                    y="0"
                    width="16"
                    height="16"
                  >
                    <path
                      d="M6 2a1 1 0 0 0-1 1v.5H3a1 1 0 0 0-1 1V7a.5.5 0 0 0 .5.5H3a1 1 0 1 1 0 2h-.5a.5.5 0 0 0-.5.5v2.5a1 1 0 0 0 1 1h2.5a.5.5 0 0 0 .5-.5V13a1 1 0 1 1 2 0v.5a.5.5 0 0 0 .5.5H12a1 1 0 0 0 1-1V10a.5.5 0 0 0-.5-.5H12a1 1 0 1 1 0-2h.5A.5.5 0 0 0 13 7V4.5a1 1 0 0 0-1-1h-2V3a1 1 0 0 0-1-1H6Z"
                      fill="currentColor"
                    />
                  </mask>
                  <g mask="url(#icon-plugins)">
                    <rect width="16" height="16" fill="currentColor" />
                  </g>
                </svg>
              </span>
              Plugins
            </span>
            <span className="composer-add-row-meta">Manage →</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function UsageSummary({ usage }: { usage: ConversationUsage | null }): JSX.Element | null {
  if (!usage || usage.messageCount === 0) return null;
  const tokens = `${usage.totalInputTokens.toLocaleString()} in · ${usage.totalOutputTokens.toLocaleString()} out`;
  const cost = usage.totalCostUsd > 0 ? ` · $${usage.totalCostUsd.toFixed(4)}` : '';
  const title =
    usage.byModel
      .map(
        (r) =>
          `${r.providerId ?? 'unknown'} / ${r.modelId ?? 'unknown'}: ${r.inputTokens} in · ${r.outputTokens} out · $${r.costUsd.toFixed(4)} (${r.messageCount} msg${r.messageCount === 1 ? '' : 's'})`,
      )
      .join('\n') || undefined;
  return (
    <div className="chat-usage" title={title}>
      {tokens}
      {cost}
    </div>
  );
}

function ExportMenu({
  disabled,
  onExport,
}: {
  disabled: boolean;
  onExport: (format: ConversationExportFormat) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="chat-export" ref={popRef}>
      <button
        type="button"
        className="btn"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Export
        <svg
          className="model-picker-caret"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M2 3.5L5 6.5L8 3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div className="chat-export-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="chat-export-item"
            onClick={() => {
              setOpen(false);
              onExport('markdown');
            }}
          >
            Markdown (.md)
          </button>
          <button
            type="button"
            role="menuitem"
            className="chat-export-item"
            onClick={() => {
              setOpen(false);
              onExport('json');
            }}
          >
            JSON (.json)
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface MessageBubbleProps {
  message: StoredMessage;
  onRerun: (prompt: string) => void;
  onRegenerate: (assistantId: string) => void;
  onEdit: (text: string) => void;
}

// Discreet "copy this message" affordance, mirroring the code-block copy button.
function CopyMessageButton({ content }: { content: string }): JSX.Element | null {
  const [copied, setCopied] = useState(false);
  const text = content.trim();
  if (text.length === 0) return null;
  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard can reject without a user gesture / permission — ignore.
    }
  };
  return (
    <HoverHint hint="Copy message">
      <button type="button" className="btn btn-ghost btn-tiny" onClick={() => void onCopy()}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </HoverHint>
  );
}

function MessageBubbleInner({
  message,
  onRerun,
  onRegenerate,
  onEdit,
}: MessageBubbleProps): JSX.Element {
  const hasBlocks = message.contentBlocks !== null && message.contentBlocks.length > 0;
  const memoryHeading = useMemo(
    () => `Chat ${new Date(message.createdAt).toISOString().slice(0, 10)}`,
    [message.createdAt],
  );
  return (
    <article
      id={`chat-message-${message.id}`}
      className={`chat-bubble chat-bubble-${message.role}`}
    >
      <header className="chat-bubble-head">{roleLabel(message.role)}</header>
      {hasBlocks ? (
        <BlockSequence blocks={message.contentBlocks ?? []} onRerun={onRerun} />
      ) : message.role === 'assistant' ? (
        <AssistantText text={message.content} />
      ) : (
        <Markdown text={message.content} />
      )}
      {message.role === 'assistant' &&
      (message.inputTokens !== null || message.costUsd !== null) ? (
        <footer className="chat-bubble-foot">
          {message.inputTokens !== null
            ? `${message.inputTokens} in · ${message.outputTokens ?? 0} out`
            : ''}
          {message.costUsd !== null ? ` · $${message.costUsd.toFixed(4)}` : ''}
        </footer>
      ) : null}
      {message.role === 'assistant' ? (
        <div className="chat-bubble-actions">
          <CopyMessageButton content={message.content} />
          <HoverHint hint="Regenerate this reply">
            <button
              type="button"
              className="btn btn-ghost btn-tiny"
              onClick={() => onRegenerate(message.id)}
            >
              Retry
            </button>
          </HoverHint>
          <AddToMemoryButton content={message.content} defaultHeading={memoryHeading} />
          <CheckpointRestoreButton messageId={message.id} />
        </div>
      ) : (
        <div className="chat-bubble-actions">
          <CopyMessageButton content={message.content} />
          <HoverHint hint="Edit & resend">
            <button
              type="button"
              className="btn btn-ghost btn-tiny"
              onClick={() => onEdit(message.content)}
            >
              Edit
            </button>
          </HoverHint>
        </div>
      )}
    </article>
  );
}

// Stored messages are immutable once persisted, so a shallow id+content
// comparator is sufficient — and load-bearing during streaming so the
// per-delta state update on the active draft doesn't re-render the entire
// finalized history above it.
export function messageBubblePropsEqual(
  prev: MessageBubbleProps,
  next: MessageBubbleProps,
): boolean {
  if (prev.onRerun !== next.onRerun) return false;
  if (prev.onRegenerate !== next.onRegenerate) return false;
  if (prev.onEdit !== next.onEdit) return false;
  const a = prev.message;
  const b = next.message;
  return (
    a.id === b.id &&
    a.content === b.content &&
    a.role === b.role &&
    a.contentBlocks === b.contentBlocks &&
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.costUsd === b.costUsd &&
    a.createdAt === b.createdAt
  );
}

const MessageBubble = memo(MessageBubbleInner, messageBubblePropsEqual);

function DraftBubble({
  draft,
  onRerun,
}: {
  draft: AssistantDraft;
  onRerun: (prompt: string) => void;
}): JSX.Element {
  const hasBlocks = draft.blocks.length > 0;
  return (
    <article className="chat-bubble chat-bubble-assistant chat-bubble-draft">
      <header className="chat-bubble-head">Assistant{!draft.done ? <CaretBlink /> : null}</header>
      {hasBlocks ? (
        <BlockSequence blocks={draft.blocks} onRerun={onRerun} />
      ) : draft.done ? (
        <Markdown text="" />
      ) : (
        <ThinkingDots />
      )}
      {draft.error ? <p className="chat-warn">{draft.error}</p> : null}
      {draft.inputTokens !== null ? (
        <footer className="chat-bubble-foot">
          {draft.inputTokens} in · {draft.outputTokens ?? 0} out
          {draft.costUsd !== null ? ` · $${draft.costUsd.toFixed(4)}` : ''}
        </footer>
      ) : null}
    </article>
  );
}

function BlockSequence({
  blocks,
  onRerun,
}: {
  blocks: ContentBlock[];
  onRerun: (prompt: string) => void;
}): JSX.Element {
  const items = groupContentBlocks(blocks);
  return (
    <div className="chat-bubble-body">
      {items.map((item, idx) => {
        if (item.kind === 'text') {
          return <AssistantText key={idx} text={item.text} />;
        }
        if (item.kind === 'tool') {
          return (
            <ToolCallCard
              key={item.use.id || idx}
              use={item.use}
              result={item.result}
              onRerun={onRerun}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

function CaretBlink(): JSX.Element {
  return <span className="chat-caret" aria-hidden="true" />;
}

function ThinkingDots(): JSX.Element {
  return (
    <div className="chat-thinking-dots" role="status" aria-label="Thinking">
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}

// A distinct, collapsible reasoning block (default collapsed). Renders the
// chain-of-thought that some reasoning models emit inline via <think> tags.
function ThinkingBlock({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const trimmed = text.trim();
  const lineCount = trimmed.length === 0 ? 0 : trimmed.split('\n').length;
  return (
    <div className={open ? 'chat-thinking chat-thinking-open' : 'chat-thinking'}>
      <button
        type="button"
        className="chat-thinking-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="chat-thinking-chevron" aria-hidden="true">
          ▸
        </span>
        <span className="chat-thinking-label">Thinking</span>
        {lineCount > 0 ? (
          <span className="chat-thinking-meta">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
        ) : null}
      </button>
      {open && trimmed.length > 0 ? (
        <div className="chat-thinking-body">
          <Markdown text={text} />
        </div>
      ) : null}
    </div>
  );
}

// Renders assistant text, splitting out any inline <think> reasoning into
// collapsible ThinkingBlocks. Falls back to plain Markdown when there is none.
function AssistantText({ text }: { text: string }): JSX.Element {
  const segments = useMemo(() => splitThinkingSegments(text), [text]);
  if (segments.length === 1 && segments[0]?.kind === 'text') {
    return <Markdown text={text} />;
  }
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'think' ? (
          <ThinkingBlock key={i} text={seg.text} />
        ) : (
          <Markdown key={i} text={seg.text} />
        ),
      )}
    </>
  );
}

function composerPlaceholder(
  modelName: string,
  transferOrigin: 'agent' | 'codebase' | null | undefined,
  streaming: boolean,
): string {
  if (streaming) return 'Generating response — press Esc to stop';
  if (transferOrigin === 'agent') return 'Continue from subagent run…';
  if (transferOrigin === 'codebase') return 'Ask about this file…';
  return `Ask ${modelName} anything…`;
}

function joinWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const sep = workspaceRoot.includes('\\') && !workspaceRoot.includes('/') ? '\\' : '/';
  const root = workspaceRoot.replace(/[\\/]+$/, '');
  const rel = relativePath.replace(/^[\\/]+/, '');
  const normalizedRel = sep === '\\' ? rel.replace(/\//g, '\\') : rel;
  return `${root}${sep}${normalizedRel}`;
}

function roleLabel(role: StoredMessage['role']): string {
  switch (role) {
    case 'user':
      return 'You';
    case 'assistant':
      return 'Assistant';
    case 'system':
      return '';
    case 'tool':
      return '';
  }
}

function QueueStrip({
  queued,
  onRemove,
}: {
  queued: QueuedMessage[];
  onRemove: (id: string) => void;
}): JSX.Element {
  return (
    <div className="chat-queue" role="list" aria-label="Queued messages">
      {queued.map((q, i) => {
        const preview = queuedPreview(q);
        return (
          <span
            key={q.id}
            className="chat-queue-chip"
            role="listitem"
            data-testid={`chat-queue-chip-${i}`}
          >
            <span className="chat-queue-chip-index">#{i + 1}</span>
            <span className="chat-queue-chip-preview" title={preview}>
              {preview}
            </span>
            <button
              type="button"
              className="chat-queue-chip-remove"
              onClick={() => onRemove(q.id)}
              aria-label={`Remove queued message ${i + 1}`}
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}

function queuedPreview(q: QueuedMessage): string {
  const trimmed = q.text.trim();
  if (trimmed.length > 0) return trimmed;
  if (q.attachments.length > 0) {
    return q.attachments.length === 1
      ? (q.attachments[0]?.name ?? '1 attachment')
      : `${q.attachments.length} attachments`;
  }
  return '';
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove: () => void;
}): JSX.Element {
  const icon =
    attachment.kind === 'image' ? (
      /* image */
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block' }}
      >
        <rect
          x="1"
          y="2"
          width="14"
          height="12"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
        />
        <circle cx="5.5" cy="6.5" r="1.5" fill="currentColor" />
        <path
          d="M1 12l4-4 3 3 2-2 5 5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ) : attachment.kind === 'text' ? (
      /* document */
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block' }}
      >
        <path
          d="M4 1h6l4 4v10H4V1Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          fill="none"
        />
        <path d="M9 1v5h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M6 9h5M6 12h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ) : (
      /* paperclip */
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block' }}
      >
        <path
          d="M13 7.5l-5.5 5.5a4 4 0 0 1-5.66-5.66l6.36-6.36a2.5 2.5 0 0 1 3.54 3.54L5.38 10.38a1 1 0 0 1-1.42-1.42L9 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  const label =
    attachment.kind === 'text' && attachment.truncated
      ? `${attachment.name} (truncated)`
      : attachment.name;
  const size = formatAttachmentSize(attachment.sizeBytes);
  return (
    <span className={`chat-attachment chat-attachment-${attachment.kind}`}>
      <span className="chat-attachment-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="chat-attachment-name" title={attachment.path}>
        {label}
      </span>
      <span className="chat-attachment-size">{size}</span>
      <button
        type="button"
        className="chat-attachment-remove"
        onClick={onRemove}
        aria-label={`Remove ${attachment.name}`}
      >
        ×
      </button>
    </span>
  );
}

function formatAttachmentSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
