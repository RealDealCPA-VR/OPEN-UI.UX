import type { McpHealthEvent, McpHealthStats } from '../../shared/mcp-registry';

const MAX_EVENTS_PER_SERVER = 50;
const MAX_RECENT_ERRORS = 10;

interface InternalStats {
  status: string;
  lastSeenAt: string | null;
  connectedAt: string | null;
  reconnectCount: number;
  errorCount: number;
  recentErrors: Array<{ at: string; message: string }>;
  events: McpHealthEvent[];
}

const statsByServer = new Map<string, InternalStats>();

function ensureStats(serverId: string): InternalStats {
  let s = statsByServer.get(serverId);
  if (!s) {
    s = {
      status: 'disconnected',
      lastSeenAt: null,
      connectedAt: null,
      reconnectCount: 0,
      errorCount: 0,
      recentErrors: [],
      events: [],
    };
    statsByServer.set(serverId, s);
  }
  return s;
}

function pushEvent(s: InternalStats, event: McpHealthEvent): void {
  s.events.push(event);
  if (s.events.length > MAX_EVENTS_PER_SERVER) {
    s.events.splice(0, s.events.length - MAX_EVENTS_PER_SERVER);
  }
}

export function recordConnected(serverId: string): void {
  const s = ensureStats(serverId);
  const at = new Date().toISOString();
  s.status = 'connected';
  s.connectedAt = at;
  s.lastSeenAt = at;
  pushEvent(s, { at, kind: 'connected' });
}

export function recordDisconnected(serverId: string, detail?: string): void {
  const s = ensureStats(serverId);
  const at = new Date().toISOString();
  s.status = 'disconnected';
  pushEvent(
    s,
    detail !== undefined ? { at, kind: 'disconnected', detail } : { at, kind: 'disconnected' },
  );
}

export function recordReconnect(serverId: string): void {
  const s = ensureStats(serverId);
  const at = new Date().toISOString();
  s.reconnectCount += 1;
  pushEvent(s, { at, kind: 'reconnect' });
}

export function recordError(serverId: string, message: string): void {
  const s = ensureStats(serverId);
  const at = new Date().toISOString();
  s.errorCount += 1;
  s.recentErrors.push({ at, message });
  if (s.recentErrors.length > MAX_RECENT_ERRORS) {
    s.recentErrors.splice(0, s.recentErrors.length - MAX_RECENT_ERRORS);
  }
  pushEvent(s, { at, kind: 'error', detail: message });
}

export function recordStatus(serverId: string, status: string): void {
  const s = ensureStats(serverId);
  s.status = status;
  if (status === 'connected') s.lastSeenAt = new Date().toISOString();
}

export function getHealthStats(serverId: string): McpHealthStats {
  const s = ensureStats(serverId);
  return {
    serverId,
    status: s.status,
    lastSeenAt: s.lastSeenAt,
    connectedAt: s.connectedAt,
    reconnectCount: s.reconnectCount,
    errorCount: s.errorCount,
    recentErrors: [...s.recentErrors],
    events: [...s.events],
  };
}

export function getAllHealthStats(serverIds: readonly string[]): McpHealthStats[] {
  return serverIds.map((id) => getHealthStats(id));
}

export function clearHealthStats(serverId: string): void {
  statsByServer.delete(serverId);
}

export function __clearAllHealthStatsForTest(): void {
  statsByServer.clear();
}
