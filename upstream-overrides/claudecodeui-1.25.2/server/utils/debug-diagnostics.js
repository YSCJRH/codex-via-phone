import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

const MAX_CONNECTIVITY_EVENTS = 1000;
const MAX_SYNC_EVENTS = 1000;
const MAX_SYNC_SNAPSHOTS = 200;

const RUNTIME_DIR = process.env.DATABASE_PATH
  ? path.dirname(path.resolve(process.env.DATABASE_PATH))
  : path.resolve(__dirname, '../../.runtime');

const DIAGNOSTICS_DIR = path.join(RUNTIME_DIR, 'diagnostics');
const CONNECTIVITY_EVENTS_FILE = path.join(DIAGNOSTICS_DIR, 'connectivity-events.json');
const SYNC_EVENTS_FILE = path.join(DIAGNOSTICS_DIR, 'sync-events.json');
const SYNC_SNAPSHOTS_FILE = path.join(DIAGNOSTICS_DIR, 'sync-snapshots.json');

let statePromise = null;
let persistPromise = Promise.resolve();

function safeTimestamp(value) {
  const timestamp = value ? new Date(value) : new Date();
  if (Number.isNaN(timestamp.getTime())) {
    return new Date().toISOString();
  }
  return timestamp.toISOString();
}

function cleanString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumeric(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function appendBounded(list, item, maxLength) {
  list.push(item);
  if (list.length > maxLength) {
    list.splice(0, list.length - maxLength);
  }
  return item;
}

async function readJsonArray(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    console.warn(`[debug-diagnostics] Failed to read ${filePath}:`, error.message);
    return [];
  }
}

async function ensureState() {
  if (!statePromise) {
    statePromise = (async () => {
      await fs.mkdir(DIAGNOSTICS_DIR, { recursive: true });
      return {
        connectivityEvents: await readJsonArray(CONNECTIVITY_EVENTS_FILE),
        syncEvents: await readJsonArray(SYNC_EVENTS_FILE),
        syncSnapshots: await readJsonArray(SYNC_SNAPSHOTS_FILE),
      };
    })();
  }

  return statePromise;
}

async function persistState() {
  const state = await ensureState();
  const payloads = [
    [CONNECTIVITY_EVENTS_FILE, state.connectivityEvents],
    [SYNC_EVENTS_FILE, state.syncEvents],
    [SYNC_SNAPSHOTS_FILE, state.syncSnapshots],
  ];

  for (const [filePath, payload] of payloads) {
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
    await fs.rename(tempPath, filePath);
  }
}

function schedulePersist() {
  persistPromise = persistPromise
    .catch(() => {})
    .then(() => persistState())
    .catch((error) => {
      console.warn('[debug-diagnostics] Failed to persist diagnostics:', error.message);
    });
  return persistPromise;
}

function normalizeConnectivityEvent(event = {}) {
  return {
    id: cleanString(event.id) || crypto.randomUUID(),
    timestamp: safeTimestamp(event.timestamp),
    surface: cleanString(event.surface) || 'server',
    sessionId: cleanString(event.sessionId),
    connectionId: cleanString(event.connectionId),
    event: cleanString(event.event) || 'unknown',
    detail: event.detail ?? null,
  };
}

function normalizeSyncEvent(event = {}) {
  return {
    id: cleanString(event.id) || crypto.randomUUID(),
    timestamp: safeTimestamp(event.timestamp),
    surface: cleanString(event.surface) || 'server',
    sessionId: cleanString(event.sessionId),
    connectionId: cleanString(event.connectionId),
    event: cleanString(event.event) || 'unknown',
    detail: event.detail ?? null,
  };
}

function normalizeSyncSnapshot(snapshot = {}) {
  const normalized = {
    id: cleanString(snapshot.id) || crypto.randomUUID(),
    timestamp: safeTimestamp(snapshot.timestamp),
    surface: cleanString(snapshot.surface) || 'server',
    sessionId: cleanString(snapshot.sessionId),
    connectionId: cleanString(snapshot.connectionId),
    selectedProject: cleanString(snapshot.selectedProject),
    selectedSession: cleanString(snapshot.selectedSession),
    selectedSessionRefreshKey: cleanString(snapshot.selectedSessionRefreshKey),
    externalMessageUpdate: normalizeNumeric(snapshot.externalMessageUpdate),
    routeResolutionState: cleanString(snapshot.routeResolutionState),
    projectsChangedFile: cleanString(snapshot.projectsChangedFile),
    reloadReason: cleanString(snapshot.reloadReason),
    chatCache: cleanString(snapshot.chatCache),
    serverMessageCount: normalizeNumeric(snapshot.serverMessageCount),
    renderedMessageCount: normalizeNumeric(snapshot.renderedMessageCount),
    latestMessageTimestamp: cleanString(snapshot.latestMessageTimestamp),
  };

  if (
    normalized.serverMessageCount !== null
    && normalized.renderedMessageCount !== null
  ) {
    normalized.inSync = normalized.serverMessageCount === normalized.renderedMessageCount;
  } else {
    normalized.inSync = null;
  }

  return normalized;
}

export async function recordConnectivityEvent(event) {
  const state = await ensureState();
  const normalized = normalizeConnectivityEvent(event);
  appendBounded(state.connectivityEvents, normalized, MAX_CONNECTIVITY_EVENTS);
  void schedulePersist();
  return normalized;
}

export async function recordSyncEvent(event) {
  const state = await ensureState();
  const normalized = normalizeSyncEvent(event);
  appendBounded(state.syncEvents, normalized, MAX_SYNC_EVENTS);
  void schedulePersist();
  return normalized;
}

export async function upsertSyncSnapshot(snapshot) {
  const state = await ensureState();
  const normalized = normalizeSyncSnapshot(snapshot);
  const snapshotKey = `${normalized.surface}:${normalized.sessionId || 'global'}`;
  const existingIndex = state.syncSnapshots.findIndex((entry) => (
    `${entry.surface}:${entry.sessionId || 'global'}` === snapshotKey
  ));

  if (existingIndex >= 0) {
    state.syncSnapshots.splice(existingIndex, 1);
  }

  appendBounded(state.syncSnapshots, normalized, MAX_SYNC_SNAPSHOTS);
  void schedulePersist();
  return normalized;
}

function sortByTimestampAscending(items) {
  return [...items].sort((left, right) => (
    new Date(left.timestamp || 0).getTime() - new Date(right.timestamp || 0).getTime()
  ));
}

function filterByCommonFields(items, options = {}) {
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 200;
  const surface = cleanString(options.surface);
  const sessionId = cleanString(options.sessionId);
  const sinceMs = Number.isFinite(Number(options.sinceMs)) ? Number(options.sinceMs) : null;
  const cutoff = sinceMs !== null ? Date.now() - sinceMs : null;

  const filtered = sortByTimestampAscending(items).filter((entry) => {
    const entryTime = new Date(entry.timestamp || 0).getTime();
    if (surface && entry.surface !== surface) {
      return false;
    }
    if (sessionId && entry.sessionId !== sessionId) {
      return false;
    }
    if (cutoff !== null && entryTime < cutoff) {
      return false;
    }
    return true;
  });

  if (filtered.length <= limit) {
    return filtered;
  }

  return filtered.slice(filtered.length - limit);
}

export async function getConnectivityTimeline(options = {}) {
  const state = await ensureState();
  return filterByCommonFields(state.connectivityEvents, options);
}

export async function getSyncEvents(options = {}) {
  const state = await ensureState();
  return filterByCommonFields(state.syncEvents, options);
}

export async function getSyncSnapshots(options = {}) {
  const state = await ensureState();
  const snapshots = filterByCommonFields(state.syncSnapshots, {
    ...options,
    limit: Number.isFinite(Number(options.limit)) ? Number(options.limit) : MAX_SYNC_SNAPSHOTS,
  });

  return snapshots;
}

export async function getRecentWsDisconnectCount(windowMs = 15 * 60 * 1000) {
  const events = await getConnectivityTimeline({ limit: MAX_CONNECTIVITY_EVENTS, sinceMs: windowMs });
  return events.filter((entry) => entry.event === 'ws_close').length;
}

async function findLatestSnapshot(predicate) {
  const snapshots = await getSyncSnapshots({ limit: MAX_SYNC_SNAPSHOTS });
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    if (predicate(snapshots[index])) {
      return snapshots[index];
    }
  }
  return null;
}

export async function getLastSuccessfulMobileSync() {
  return findLatestSnapshot((snapshot) => snapshot.surface === 'mobile' && snapshot.inSync === true);
}

export async function getLastSyncDivergence() {
  const divergenceSnapshot = await findLatestSnapshot((snapshot) => snapshot.inSync === false);
  if (divergenceSnapshot) {
    return divergenceSnapshot;
  }

  const syncEvents = await getSyncEvents({ limit: MAX_SYNC_EVENTS });
  for (let index = syncEvents.length - 1; index >= 0; index -= 1) {
    if (syncEvents[index].event === 'sync_divergence_detected') {
      return syncEvents[index];
    }
  }

  return null;
}

export async function getDiagnosticsSummary() {
  const [wsRecentDisconnects, lastSuccessfulMobileSync, lastSyncDivergence] = await Promise.all([
    getRecentWsDisconnectCount(),
    getLastSuccessfulMobileSync(),
    getLastSyncDivergence(),
  ]);

  return {
    wsRecentDisconnects,
    lastSuccessfulMobileSync,
    lastSyncDivergence,
  };
}

export async function buildExportBundle(options = {}) {
  const sessionId = cleanString(options.sessionId);
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 200;
  const [connectivityTimeline, syncEvents, syncSnapshots, summary] = await Promise.all([
    getConnectivityTimeline({ limit, sessionId }),
    getSyncEvents({ limit, sessionId }),
    getSyncSnapshots({ limit, sessionId }),
    getDiagnosticsSummary(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    diagnosticsDir: DIAGNOSTICS_DIR,
    connectivityTimeline,
    syncEvents,
    syncSnapshots,
    summary,
  };
}

export function getDiagnosticsPaths() {
  return {
    runtimeDir: RUNTIME_DIR,
    diagnosticsDir: DIAGNOSTICS_DIR,
    connectivityEventsFile: CONNECTIVITY_EVENTS_FILE,
    syncEventsFile: SYNC_EVENTS_FILE,
    syncSnapshotsFile: SYNC_SNAPSHOTS_FILE,
  };
}
