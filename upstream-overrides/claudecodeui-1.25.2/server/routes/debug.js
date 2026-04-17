import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import {
  buildExportBundle,
  getConnectivityTimeline,
  getDiagnosticsSummary,
  getDiagnosticsPaths,
  getSyncEvents,
  getSyncSnapshots,
  recordConnectivityEvent,
  recordSyncEvent,
  upsertSyncSnapshot,
} from '../utils/debug-diagnostics.js';
import {
  getCodexSessionMessages,
  getCodexSessionsPage,
  getProjectsCacheDebugInfo,
  resolveCodexSessionTarget,
} from '../projects.js';

const router = express.Router();

function normalizeClientSurface(surface) {
  return surface === 'mobile' ? 'mobile' : 'desktop';
}

function parseLimit(value, fallback = 200) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function readRuntimeJson(relativePath) {
  const runtimePath = path.join(getDiagnosticsPaths().runtimeDir, relativePath);
  try {
    const raw = await fs.readFile(runtimePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

router.get('/connectivity/timeline', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 200);
    const sinceMs = parseLimit(req.query.sinceMs, 0);
    const [timeline, summary] = await Promise.all([
      getConnectivityTimeline({
        limit,
        sinceMs: sinceMs > 0 ? sinceMs : undefined,
        surface: req.query.surface,
        sessionId: req.query.sessionId,
      }),
      getDiagnosticsSummary(),
    ]);

    res.json({
      success: true,
      timeline,
      summary,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.post('/connectivity/client-event', async (req, res) => {
  try {
    const event = await recordConnectivityEvent({
      ...req.body,
      surface: normalizeClientSurface(req.body?.surface),
    });
    res.json({ success: true, event });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/sync/client-event', async (req, res) => {
  try {
    const event = await recordSyncEvent({
      ...req.body,
      surface: normalizeClientSurface(req.body?.surface),
    });
    res.json({ success: true, event });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/sync/client-snapshot', async (req, res) => {
  try {
    const snapshot = await upsertSyncSnapshot({
      ...req.body,
      surface: normalizeClientSurface(req.body?.surface),
    });
    res.json({ success: true, snapshot });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/sync/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const [target, messagePayload, cacheInfo, syncEvents, syncSnapshots] = await Promise.all([
      resolveCodexSessionTarget(sessionId),
      getCodexSessionMessages(sessionId, null, 0),
      Promise.resolve(getProjectsCacheDebugInfo()),
      getSyncEvents({ sessionId, limit: 100 }),
      getSyncSnapshots({ sessionId, limit: 20 }),
    ]);

    const messages = Array.isArray(messagePayload?.messages) ? messagePayload.messages : [];
    const latestMessageTimestamp = messages.length > 0
      ? messages[messages.length - 1]?.timestamp || null
      : null;

    let isInTopSidebarSlice = null;
    if (target?.project?.path) {
      const sessionPage = await getCodexSessionsPage(target.project.path, { limit: 5, offset: 0 });
      isInTopSidebarSlice = Boolean(sessionPage.sessions?.some((session) => session.id === sessionId));
    }

    const latestSnapshotsBySurface = syncSnapshots.reduce((accumulator, snapshot) => {
      accumulator[snapshot.surface] = snapshot;
      return accumulator;
    }, {});

    res.json({
      success: true,
      sessionId,
      projectTarget: target?.project
        ? {
          name: target.project.name,
          displayName: target.project.displayName,
          path: target.project.path,
        }
        : null,
      sessionExists: Boolean(target?.session),
      latestMessageTimestamp,
      messageCount: messages.length,
      isInTopSidebarSlice,
      lastProjectsSnapshotRefreshTime: cacheInfo.updatedAt,
      recentSyncEvents: syncEvents,
      latestSnapshotsBySurface,
      snapshots: syncSnapshots,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.get('/export-bundle', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 200);
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : null;
    const [bundle, appBinding, desktopApprovalBridge] = await Promise.all([
      buildExportBundle({ sessionId, limit }),
      readRuntimeJson('app-binding.json'),
      readRuntimeJson('desktop-approval-bridge-window.json'),
    ]);

    res.json({
      success: true,
      ...bundle,
      binding: appBinding,
      desktopApprovalBridge,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
