import { api } from './api';

export type DiagnosticsSurface = 'mobile' | 'desktop' | 'server' | 'control';

export type ConnectivityEvent = {
  id: string;
  timestamp: string;
  surface: DiagnosticsSurface;
  sessionId: string | null;
  connectionId: string | null;
  event: string;
  detail: unknown;
};

export type SessionSyncEvent = {
  id: string;
  timestamp: string;
  surface: DiagnosticsSurface;
  sessionId: string | null;
  connectionId: string | null;
  event: string;
  detail: unknown;
};

export type SessionSyncSnapshot = {
  id: string;
  timestamp: string;
  surface: DiagnosticsSurface;
  sessionId: string | null;
  connectionId: string | null;
  selectedProject: string | null;
  selectedSession: string | null;
  selectedSessionRefreshKey: string | null;
  externalMessageUpdate: number | null;
  routeResolutionState: string | null;
  projectsChangedFile: string | null;
  reloadReason: string | null;
  chatCache: string | null;
  serverMessageCount: number | null;
  renderedMessageCount: number | null;
  latestMessageTimestamp: string | null;
  inSync: boolean | null;
};

const MAX_BUFFER_SIZE = 200;
const connectivityBuffer: ConnectivityEvent[] = [];
const syncEventBuffer: SessionSyncEvent[] = [];
const syncSnapshotBuffer: SessionSyncSnapshot[] = [];
const snapshotSignatures = new Map<string, string>();

function detectSurface(): DiagnosticsSurface {
  if (typeof window === 'undefined') {
    return 'desktop';
  }

  const userAgent = window.navigator?.userAgent || '';
  if (/iphone|ipad|android|mobile/i.test(userAgent)) {
    return 'mobile';
  }

  return 'desktop';
}

function buildId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function appendBounded<T>(list: T[], item: T) {
  list.push(item);
  if (list.length > MAX_BUFFER_SIZE) {
    list.splice(0, list.length - MAX_BUFFER_SIZE);
  }
}

function postDebugPayload(request: Promise<Response>) {
  void request.catch(() => {});
}

export function createDiagnosticsId(prefix = 'diag'): string {
  return buildId(prefix);
}

export function recordConnectivityEvent(event: Partial<ConnectivityEvent> & { event: string }): ConnectivityEvent {
  const normalized: ConnectivityEvent = {
    id: cleanString(event.id) || buildId('conn'),
    timestamp: cleanString(event.timestamp) || new Date().toISOString(),
    surface: (cleanString(event.surface) as DiagnosticsSurface | null) || detectSurface(),
    sessionId: cleanString(event.sessionId),
    connectionId: cleanString(event.connectionId),
    event: event.event,
    detail: event.detail ?? null,
  };

  appendBounded(connectivityBuffer, normalized);
  postDebugPayload(api.debug.clientConnectivityEvent(normalized));
  return normalized;
}

export function recordSessionSyncEvent(event: Partial<SessionSyncEvent> & { event: string }): SessionSyncEvent {
  const normalized: SessionSyncEvent = {
    id: cleanString(event.id) || buildId('sync-event'),
    timestamp: cleanString(event.timestamp) || new Date().toISOString(),
    surface: (cleanString(event.surface) as DiagnosticsSurface | null) || detectSurface(),
    sessionId: cleanString(event.sessionId),
    connectionId: cleanString(event.connectionId),
    event: event.event,
    detail: event.detail ?? null,
  };

  appendBounded(syncEventBuffer, normalized);
  postDebugPayload(api.debug.clientSyncEvent(normalized));
  return normalized;
}

export function updateSessionSyncSnapshot(
  snapshot: Partial<SessionSyncSnapshot>,
): SessionSyncSnapshot {
  const normalized: SessionSyncSnapshot = {
    id: cleanString(snapshot.id) || buildId('sync-snapshot'),
    timestamp: cleanString(snapshot.timestamp) || new Date().toISOString(),
    surface: (cleanString(snapshot.surface) as DiagnosticsSurface | null) || detectSurface(),
    sessionId: cleanString(snapshot.sessionId),
    connectionId: cleanString(snapshot.connectionId),
    selectedProject: cleanString(snapshot.selectedProject),
    selectedSession: cleanString(snapshot.selectedSession),
    selectedSessionRefreshKey: cleanString(snapshot.selectedSessionRefreshKey),
    externalMessageUpdate: normalizeCount(snapshot.externalMessageUpdate),
    routeResolutionState: cleanString(snapshot.routeResolutionState),
    projectsChangedFile: cleanString(snapshot.projectsChangedFile),
    reloadReason: cleanString(snapshot.reloadReason),
    chatCache: cleanString(snapshot.chatCache),
    serverMessageCount: normalizeCount(snapshot.serverMessageCount),
    renderedMessageCount: normalizeCount(snapshot.renderedMessageCount),
    latestMessageTimestamp: cleanString(snapshot.latestMessageTimestamp),
    inSync: null,
  };

  if (
    normalized.serverMessageCount !== null
    && normalized.renderedMessageCount !== null
  ) {
    normalized.inSync = normalized.serverMessageCount === normalized.renderedMessageCount;
  }

  const snapshotKey = `${normalized.surface}:${normalized.sessionId || 'global'}`;
  const signature = JSON.stringify(normalized);
  if (snapshotSignatures.get(snapshotKey) === signature) {
    return normalized;
  }

  snapshotSignatures.set(snapshotKey, signature);
  const existingIndex = syncSnapshotBuffer.findIndex((entry) => (
    `${entry.surface}:${entry.sessionId || 'global'}` === snapshotKey
  ));
  if (existingIndex >= 0) {
    syncSnapshotBuffer.splice(existingIndex, 1);
  }

  appendBounded(syncSnapshotBuffer, normalized);
  postDebugPayload(api.debug.clientSyncSnapshot(normalized));
  return normalized;
}

export function getLocalDiagnosticsBuffer() {
  return {
    connectivity: [...connectivityBuffer],
    syncEvents: [...syncEventBuffer],
    syncSnapshots: [...syncSnapshotBuffer],
  };
}
