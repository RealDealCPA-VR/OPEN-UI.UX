import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  AUDIT_BUNDLE_FORMAT,
  type AuditBundle,
  type AuditBundleEnvelope,
  type AuditBundleEntry,
  canonicalizeBundle,
} from '@opencodex/audit-verify';
import { getDb } from '../storage/db';
import { SQLITE_LIKE_ESCAPE_CLAUSE, wrapContains } from '../storage/like-escape';
import { getOrCreateAuditSigningKey, signAuditPayload } from './audit-signing';
import { getSettings, updateSettings } from '../storage/settings';
import type {
  ToolCallAuditDecision,
  ToolCallAuditExportRequest,
  ToolCallAuditTriggerSource,
} from '../../shared/tool-audit';

interface RawExportRow {
  id: string;
  message_id: string;
  tool_name: string;
  input_json: string;
  output_json: string | null;
  decision: string;
  is_error: number;
  duration_ms: number | null;
  created_at: string;
  trigger_source: string;
  runner_id: string | null;
  conversation_id: string;
  conversation_title: string;
}

/** Lazy device id — generated on first export, then persisted to settings. */
function getOrCreateDeviceId(): string {
  const settings = getSettings();
  if (settings.auditDeviceId && settings.auditDeviceId.length > 0) {
    return settings.auditDeviceId;
  }
  const id = randomUUID();
  updateSettings({ auditDeviceId: id });
  return id;
}

export async function exportAuditBundle(
  req: ToolCallAuditExportRequest,
  db: Database.Database = getDb(),
): Promise<AuditBundleEnvelope> {
  const { publicKeyPem, privateKey } = await getOrCreateAuditSigningKey();
  const entries = collectEntries(req, db);
  const bundle: AuditBundle = {
    format: AUDIT_BUNDLE_FORMAT,
    generatedAt: new Date().toISOString(),
    deviceId: getOrCreateDeviceId(),
    publicKey: publicKeyPem,
    entries,
  };
  const signature = signAuditPayload(canonicalizeBundle(bundle), privateKey);
  return { bundle, signature };
}

function collectEntries(
  req: ToolCallAuditExportRequest,
  db: Database.Database,
): AuditBundleEntry[] {
  const filters: string[] = [];
  const params: (string | number)[] = [];

  if (req.toolNames && req.toolNames.length > 0) {
    filters.push(`tc.tool_name IN (${req.toolNames.map(() => '?').join(', ')})`);
    params.push(...req.toolNames);
  }
  if (req.decisions && req.decisions.length > 0) {
    filters.push(`tc.decision IN (${req.decisions.map(() => '?').join(', ')})`);
    params.push(...req.decisions);
  }
  if (req.errorState === 'error') filters.push(`tc.is_error = 1`);
  else if (req.errorState === 'success') filters.push(`tc.is_error = 0`);
  if (req.runnerIds && req.runnerIds.length > 0) {
    // Mirror the sentinel handling in queryToolCalls so an "OpenCodex" filter
    // catches rows where runner_id is NULL/''/'internal'.
    const opencodexSentinels = new Set(['__opencodex__', 'internal']);
    const externalIds = req.runnerIds.filter((id) => !opencodexSentinels.has(id));
    const includeOpencodex = req.runnerIds.some((id) => opencodexSentinels.has(id));
    const parts: string[] = [];
    if (externalIds.length > 0) {
      parts.push(`tc.runner_id IN (${externalIds.map(() => '?').join(', ')})`);
      params.push(...externalIds);
    }
    if (includeOpencodex) {
      parts.push(`(tc.runner_id IS NULL OR tc.runner_id = '' OR tc.runner_id = 'internal')`);
    }
    if (parts.length > 0) filters.push(`(${parts.join(' OR ')})`);
  }
  if (req.triggerSource) {
    filters.push(`tc.trigger_source = ?`);
    params.push(req.triggerSource);
  }
  if (req.from) {
    filters.push(`tc.created_at >= ?`);
    params.push(req.from);
  }
  if (req.to) {
    filters.push(`tc.created_at <= ?`);
    params.push(req.to);
  }
  if (req.filePath) {
    filters.push(`tc.input_json LIKE ? ${SQLITE_LIKE_ESCAPE_CLAUSE}`);
    params.push(wrapContains(req.filePath));
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT tc.id, tc.message_id, tc.tool_name, tc.input_json, tc.output_json,
              tc.decision, tc.is_error, tc.duration_ms, tc.created_at, tc.trigger_source, tc.runner_id,
              m.conversation_id AS conversation_id,
              c.title AS conversation_title
         FROM tool_calls tc
         JOIN messages m ON m.id = tc.message_id
         JOIN conversations c ON c.id = m.conversation_id
         ${whereClause}
         ORDER BY tc.created_at ASC, tc.rowid ASC`,
    )
    .all(...params) as RawExportRow[];

  return rows.map((r) => ({
    id: r.id,
    messageId: r.message_id,
    toolName: r.tool_name,
    input: parseJsonOrRaw(r.input_json),
    output: r.output_json === null ? null : parseJsonOrRaw(r.output_json),
    decision: r.decision as ToolCallAuditDecision,
    isError: r.is_error !== 0,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
    triggerSource: (r.trigger_source as ToolCallAuditTriggerSource) ?? 'user',
    runnerId: r.runner_id ?? null,
    conversationId: r.conversation_id,
    conversationTitle: r.conversation_title,
    filePath: extractFilePath(r.input_json),
  }));
}

function parseJsonOrRaw(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Pull a best-effort file path out of a tool input payload. */
function extractFilePath(rawJson: string): string | null {
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      for (const key of ['path', 'file_path', 'filePath', 'file', 'target']) {
        const v = obj[key];
        if (typeof v === 'string' && v.length > 0) return v;
      }
    }
  } catch {
    // ignore
  }
  return null;
}
