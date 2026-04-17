import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getPendingDesktopApprovals } from './desktop-approval-monitor.js';
import { isDesktopApprovalUiAutomationEnabled, resolveDesktopApprovalViaUiAutomation } from './desktop-approval-ui-automation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BRIDGE_ENABLED = process.env.MOBILE_CODEX_ENABLE_DESKTOP_APPROVAL_BRIDGE === 'true';
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;
const parsedMaxAgeMs = Number.parseInt(process.env.MOBILE_CODEX_DESKTOP_APPROVAL_MAX_AGE_MS || '', 10);
const DESKTOP_APPROVAL_MAX_AGE_MS = Number.isFinite(parsedMaxAgeMs) && parsedMaxAgeMs > 0
  ? parsedMaxAgeMs
  : DEFAULT_MAX_AGE_MS;
const REPO_RUNTIME_DIR = path.resolve(__dirname, '../../..', '.runtime');
const BRIDGE_WINDOW_FILE_PATH = path.join(REPO_RUNTIME_DIR, 'desktop-approval-bridge-window.json');
const actionStateByRequestId = new Map();
const ACTION_STATE_TTL_MS = 24 * 60 * 60 * 1000;
const ACTION_SETTLE_TIMEOUT_MS = 12000;
const ACTION_SETTLE_POLL_MS = 500;

class DesktopApprovalBridgeError extends Error {
  constructor(message, statusCode = 400, code = 'desktop_approval_bridge_error') {
    super(message);
    this.name = 'DesktopApprovalBridgeError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function createAuditDirPath() {
  return path.join(REPO_RUNTIME_DIR, 'audit');
}

function createAuditLogPath() {
  return path.join(createAuditDirPath(), 'desktop-approval-actions.jsonl');
}

async function readBridgeWindowState() {
  try {
    const raw = await fs.readFile(BRIDGE_WINDOW_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    const enabledUntil = typeof parsed?.enabledUntil === 'string' ? parsed.enabledUntil : null;
    const enabledAt = typeof parsed?.enabledAt === 'string' ? parsed.enabledAt : null;
    const reason = typeof parsed?.reason === 'string' ? parsed.reason : null;
    const timestamp = parseReceivedAt(enabledUntil, NaN);
    return {
      enabledAt,
      enabledUntil,
      reason,
      active: Boolean(enabledUntil && Number.isFinite(timestamp) && timestamp > Date.now()),
    };
  } catch {
    return {
      enabledAt: null,
      enabledUntil: null,
      reason: null,
      active: false,
    };
  }
}

function parseReceivedAt(value, fallback = Date.now()) {
  const timestamp = new Date(value || fallback).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function hashValue(value) {
  return crypto
    .createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value ?? null))
    .digest('hex');
}

function getMetadataString(metadata, key) {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getApprovalWorkingDirectory(approval) {
  const metadata = approval?.metadata && typeof approval.metadata === 'object'
    ? approval.metadata
    : null;

  return getMetadataString(metadata, 'cwd')
    || getMetadataString(metadata, 'projectPath')
    || null;
}

function serializeActionState(state) {
  if (!state) {
    return null;
  }

  return {
    requestId: state.requestId,
    sessionId: state.sessionId,
    callId: state.callId,
    action: state.action,
    status: state.status,
    actedAt: state.actedAt,
    completedAt: state.completedAt || null,
    error: state.error || null,
  };
}

async function appendAuditRecord(record) {
  const auditDir = createAuditDirPath();
  await fs.mkdir(auditDir, { recursive: true });
  await fs.appendFile(createAuditLogPath(), `${JSON.stringify(record)}\n`, 'utf8');
}

function buildAuditRecord({ requestId, approval, action, outcome, user, device, error = null }) {
  const metadata = approval?.metadata && typeof approval.metadata === 'object'
    ? approval.metadata
    : {};

  return {
    timestamp: new Date().toISOString(),
    requestId,
    sessionId: approval?.sessionId || null,
    callId: getMetadataString(metadata, 'callId'),
    action,
    outcome,
    approvedByUserId: user?.id || null,
    approvedByUsername: user?.username || null,
    approvedByDeviceId: device?.deviceId || null,
    approvedByDeviceName: device?.deviceName || null,
    approvedByPlatform: device?.platform || null,
    commandHash: hashValue(approval?.input || getMetadataString(metadata, 'command') || ''),
    messageHash: hashValue(approval?.message || ''),
    error,
  };
}

function mergeAutomationDetails(record, uiAutomationResult) {
  if (!uiAutomationResult || typeof uiAutomationResult !== 'object') {
    return record;
  }

  return {
    ...record,
    automationHostKind: typeof uiAutomationResult.hostKind === 'string' ? uiAutomationResult.hostKind : null,
    automationProcessName: typeof uiAutomationResult.processName === 'string' ? uiAutomationResult.processName : null,
    automationProcessId: Number.isFinite(uiAutomationResult.processId) ? uiAutomationResult.processId : null,
    automationWindowTitle: typeof uiAutomationResult.hostWindowTitle === 'string' ? uiAutomationResult.hostWindowTitle : null,
    automationMethod: typeof uiAutomationResult.method === 'string' ? uiAutomationResult.method : null,
    automationSwitchedThread: uiAutomationResult.switchedThread === true,
    automationThreadSwitchHost: typeof uiAutomationResult.threadSwitchHostProcess === 'string' ? uiAutomationResult.threadSwitchHostProcess : null,
    automationThreadSwitchMethod: typeof uiAutomationResult.threadSwitchMethod === 'string' ? uiAutomationResult.threadSwitchMethod : null,
    automationThreadSwitchTarget: typeof uiAutomationResult.threadSwitchTarget === 'string' ? uiAutomationResult.threadSwitchTarget : null,
  };
}

async function appendRejectedAuditRecord({ requestId, approval = null, action, user, device, error }) {
  try {
    await appendAuditRecord(buildAuditRecord({
      requestId,
      approval,
      action,
      outcome: 'rejected',
      user,
      device,
      error,
    }));
  } catch {
    // Keep bridge failures visible to the caller even if audit logging fails.
  }
}

async function getCurrentApprovalSnapshot(requestId) {
  const pendingApprovals = await getPendingDesktopApprovals({ refresh: true });
  const approval = pendingApprovals.find((item) => item.requestId === requestId) || null;
  return { approval, pendingApprovals };
}

function ensureApprovalIncluded(pendingApprovals, approval) {
  const items = Array.isArray(pendingApprovals) ? [...pendingApprovals] : [];
  if (!approval?.requestId) {
    return items;
  }

  if (items.some((item) => item?.requestId === approval.requestId)) {
    return items;
  }

  return [approval, ...items];
}

function buildResolvedState({ requestId, approval, action, status, actedAt, error = null }) {
  const metadata = approval?.metadata && typeof approval.metadata === 'object'
    ? approval.metadata
    : {};

  return {
    requestId,
    sessionId: approval?.sessionId || null,
    callId: getMetadataString(metadata, 'callId'),
    action,
    status,
    actedAt,
    completedAt: new Date().toISOString(),
    error,
  };
}

function buildUiAutomationErrorMessage(result) {
  if (!result || typeof result !== 'object') {
    return 'Desktop UI automation failed.';
  }

  const detailCandidates = [
    result.message,
    result.details,
    result.stderr,
    result.stdout,
    result.code,
  ];

  for (const candidate of detailCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return 'Desktop UI automation failed.';
}

function buildNotClearedErrorMessage(action, uiAutomationResult) {
  const invokedMethod = typeof uiAutomationResult?.method === 'string'
    ? uiAutomationResult.method
    : '';
  const switchedThread = uiAutomationResult?.switchedThread === true;
  const switchTarget = typeof uiAutomationResult?.threadSwitchTarget === 'string' && uiAutomationResult.threadSwitchTarget.trim()
    ? uiAutomationResult.threadSwitchTarget.trim()
    : null;

  let message = invokedMethod === 'KeyboardShortcut'
    ? 'Desktop shortcut was sent, but Codex Desktop did not clear the prompt. The requested approval is probably not the prompt currently visible on the computer.'
    : action === 'approve'
      ? 'Desktop approve button was invoked, but Codex Desktop did not clear the prompt.'
      : 'Desktop deny button was invoked, but Codex Desktop did not clear the prompt.';

  if (switchedThread && switchTarget) {
    message += ` The bridge switched to "${switchTarget}" first, so the desktop thread likely changed but the approval prompt still did not resolve.`;
  } else if (switchedThread) {
    message += ' The bridge switched threads first, but the approval prompt still did not resolve.';
  }

  return message;
}

function clearExpiredActionStates() {
  const now = Date.now();
  for (const [requestId, state] of actionStateByRequestId.entries()) {
    const timestamp = parseReceivedAt(state?.completedAt || state?.actedAt || now);
    if (now - timestamp > ACTION_STATE_TTL_MS) {
      actionStateByRequestId.delete(requestId);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForApprovalToSettle(requestId, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : ACTION_SETTLE_TIMEOUT_MS;
  const pollMs = Number.isFinite(options.pollMs) && options.pollMs > 0
    ? options.pollMs
    : ACTION_SETTLE_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  let latestPendingApprovals = [];

  while (Date.now() <= deadline) {
    const { approval, pendingApprovals } = await getCurrentApprovalSnapshot(requestId);
    latestPendingApprovals = pendingApprovals;

    if (!approval) {
      return {
        cleared: true,
        pendingApprovals,
      };
    }

    if (Date.now() >= deadline) {
      break;
    }

    await sleep(pollMs);
  }

  return {
    cleared: false,
    pendingApprovals: latestPendingApprovals,
  };
}

export function isDesktopApprovalBridgeEnabled() {
  return BRIDGE_ENABLED;
}

export async function getDesktopApprovalBridgeStatus() {
  const bridgeWindow = await readBridgeWindowState();
  const active = BRIDGE_ENABLED && bridgeWindow.active;

  let message = 'Enable remote desktop approvals on the computer first.';
  if (!BRIDGE_ENABLED) {
    message = 'Remote desktop approval bridge is disabled in this deployment.';
  } else if (!isDesktopApprovalUiAutomationEnabled()) {
    message = 'Remote desktop approvals are enabled, but desktop UI automation is unavailable on this computer.';
  } else if (active && bridgeWindow.enabledUntil) {
    message = `Remote desktop approvals are enabled until ${bridgeWindow.enabledUntil}.`;
  } else if (bridgeWindow.enabledUntil) {
    message = 'Remote desktop approval window expired on the computer. Enable it again to approve from mobile.';
  }

  return {
    enabled: BRIDGE_ENABLED,
    active,
    enabledAt: bridgeWindow.enabledAt,
    enabledUntil: bridgeWindow.enabledUntil,
    reason: bridgeWindow.reason,
    maxAgeMs: DESKTOP_APPROVAL_MAX_AGE_MS,
    message,
  };
}

export async function resolveDesktopApprovalRequest({ requestId, action, user, device, viewerSessionId }) {
  clearExpiredActionStates();

  if (!BRIDGE_ENABLED) {
    await appendRejectedAuditRecord({
      requestId,
      action,
      user,
      device,
      error: 'bridge_disabled',
    });
    throw new DesktopApprovalBridgeError(
      'Remote desktop approval bridge is disabled on this computer.',
      403,
      'bridge_disabled',
    );
  }

  const bridgeWindow = await readBridgeWindowState();
  if (!bridgeWindow.active) {
    await appendRejectedAuditRecord({
      requestId,
      action,
      user,
      device,
      error: 'bridge_window_inactive',
    });
    throw new DesktopApprovalBridgeError(
      'Remote desktop approvals are not enabled right now. Enable them on the computer first.',
      403,
      'bridge_window_inactive',
    );
  }

  if (!user?.id || !device?.deviceId) {
    await appendRejectedAuditRecord({
      requestId,
      action,
      user,
      device,
      error: 'trusted_device_required',
    });
    throw new DesktopApprovalBridgeError(
      'Remote desktop approvals require a trusted, logged-in device.',
      403,
      'trusted_device_required',
    );
  }

  const normalizedRequestId = String(requestId || '').trim();
  if (!normalizedRequestId) {
    await appendRejectedAuditRecord({
      requestId: normalizedRequestId,
      action,
      user,
      device,
      error: 'request_id_required',
    });
    throw new DesktopApprovalBridgeError('A desktop approval request id is required.', 400, 'request_id_required');
  }

  const normalizedAction = String(action || '').trim().toLowerCase();
  if (normalizedAction !== 'approve' && normalizedAction !== 'deny') {
    await appendRejectedAuditRecord({
      requestId: normalizedRequestId,
      action: normalizedAction,
      user,
      device,
      error: 'invalid_action',
    });
    throw new DesktopApprovalBridgeError('Only approve-once and deny are supported remotely.', 400, 'invalid_action');
  }

  const normalizedViewerSessionId = String(viewerSessionId || '').trim();
  if (!normalizedViewerSessionId) {
    await appendRejectedAuditRecord({
      requestId: normalizedRequestId,
      action: normalizedAction,
      user,
      device,
      error: 'viewer_session_required',
    });
    throw new DesktopApprovalBridgeError(
      'Open the matching thread on mobile before sending a desktop approval reply.',
      409,
      'viewer_session_required',
    );
  }

  const existingState = actionStateByRequestId.get(normalizedRequestId);
  if (existingState?.status === 'executing') {
    return {
      ok: false,
      httpStatus: 409,
      message: 'This desktop approval is already being processed.',
      state: serializeActionState(existingState),
      pendingApprovals: await getPendingDesktopApprovals({ refresh: false }),
    };
  }

  if (existingState?.status && existingState.status !== 'failed') {
    const currentSnapshot = await getCurrentApprovalSnapshot(normalizedRequestId);
    if (currentSnapshot.approval) {
      actionStateByRequestId.delete(normalizedRequestId);
    } else {
      return {
        ok: existingState.status === 'approved' || existingState.status === 'denied',
        httpStatus: existingState.status === 'stale' ? 409 : 200,
        message: existingState.status === 'stale'
          ? 'This desktop approval is no longer pending.'
          : 'This desktop approval was already handled.',
        state: serializeActionState(existingState),
        pendingApprovals: currentSnapshot.pendingApprovals,
      };
    }
  }

  const reloadedState = actionStateByRequestId.get(normalizedRequestId);
  if (reloadedState?.status && reloadedState.status !== 'failed' && reloadedState.status !== 'executing') {
    return {
      ok: reloadedState.status === 'approved' || reloadedState.status === 'denied',
      httpStatus: reloadedState.status === 'stale' ? 409 : 200,
      message: reloadedState.status === 'stale'
        ? 'This desktop approval is no longer pending.'
        : 'This desktop approval was already handled.',
      state: serializeActionState(reloadedState),
      pendingApprovals: await getPendingDesktopApprovals({ refresh: true }),
    };
  }

  const { approval, pendingApprovals } = await getCurrentApprovalSnapshot(normalizedRequestId);
  if (!approval) {
    const staleState = buildResolvedState({
      requestId: normalizedRequestId,
      approval: null,
      action: normalizedAction,
      status: 'stale',
      actedAt: new Date().toISOString(),
      error: 'Request not found in the current desktop approval snapshot.',
    });
    actionStateByRequestId.set(normalizedRequestId, staleState);
    return {
      ok: false,
      httpStatus: 409,
      message: 'That desktop approval is no longer pending.',
      state: serializeActionState(staleState),
      pendingApprovals: await getPendingDesktopApprovals({ refresh: false }),
    };
  }

  if (approval?.metadata?.bridgeSupported !== true) {
    await appendRejectedAuditRecord({
      requestId: normalizedRequestId,
      approval,
      action: normalizedAction,
      user,
      device,
      error: 'bridge_unsupported_request',
    });
    throw new DesktopApprovalBridgeError(
      'This desktop approval is not marked as safe for the mobile bridge.',
      409,
      'bridge_unsupported_request',
    );
  }

  if (approval.sessionId !== normalizedViewerSessionId) {
    await appendRejectedAuditRecord({
      requestId: normalizedRequestId,
      approval,
      action: normalizedAction,
      user,
      device,
      error: 'viewer_session_mismatch',
    });
    throw new DesktopApprovalBridgeError(
      'Open this exact thread on mobile before approving it remotely.',
      409,
      'viewer_session_mismatch',
    );
  }

  const receivedAt = parseReceivedAt(approval.receivedAt);
  if (Date.now() - receivedAt > DESKTOP_APPROVAL_MAX_AGE_MS) {
    const staleState = buildResolvedState({
      requestId: normalizedRequestId,
      approval,
      action: normalizedAction,
      status: 'stale',
      actedAt: new Date().toISOString(),
      error: 'Request is older than the remote approval time window.',
    });
    actionStateByRequestId.set(normalizedRequestId, staleState);
    await appendAuditRecord(buildAuditRecord({
      requestId: normalizedRequestId,
      approval,
      action: normalizedAction,
      outcome: 'stale',
      user,
      device,
      error: staleState.error,
    }));
    return {
      ok: false,
      httpStatus: 409,
      message: 'That desktop approval is too old to approve remotely.',
      state: serializeActionState(staleState),
      pendingApprovals: await getPendingDesktopApprovals({ refresh: false }),
    };
  }

  const cwd = getApprovalWorkingDirectory(approval);
  if (!cwd) {
    await appendRejectedAuditRecord({
      requestId: normalizedRequestId,
      approval,
      action: normalizedAction,
      user,
      device,
      error: 'missing_workdir',
    });
    throw new DesktopApprovalBridgeError(
      'This desktop approval is missing its working directory, so the bridge cannot safely resume it.',
      409,
      'missing_workdir',
    );
  }

  const actingState = {
    requestId: normalizedRequestId,
    sessionId: approval.sessionId || null,
    callId: getMetadataString(approval.metadata, 'callId'),
    action: normalizedAction,
    status: 'executing',
    actedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
  actionStateByRequestId.set(normalizedRequestId, actingState);

  await appendAuditRecord(buildAuditRecord({
    requestId: normalizedRequestId,
    approval,
    action: normalizedAction,
    outcome: 'started',
    user,
    device,
  }));

  try {
    const uiAutomationApproval = {
      ...approval,
      metadata: {
        ...(approval?.metadata && typeof approval.metadata === 'object' ? approval.metadata : {}),
        allowShortcutFallback: Array.isArray(pendingApprovals) && pendingApprovals.length === 1,
        allowThreadSwitch: Boolean(
          approval?.metadata
          && typeof approval.metadata === 'object'
          && (
            getMetadataString(approval.metadata, 'sessionSummary')
            || getMetadataString(approval.metadata, 'projectLabel')
            || approval.sessionId
          ),
        ),
      },
    };
    const uiAutomationResult = await resolveDesktopApprovalViaUiAutomation(uiAutomationApproval, normalizedAction);
    if (!uiAutomationResult?.ok) {
      const uiAutomationError = buildUiAutomationErrorMessage(uiAutomationResult);
      const failedState = buildResolvedState({
        requestId: normalizedRequestId,
        approval,
        action: normalizedAction,
        status: 'failed',
        actedAt: actingState.actedAt,
        error: uiAutomationError,
      });
      actionStateByRequestId.set(normalizedRequestId, failedState);
      await appendAuditRecord(mergeAutomationDetails(buildAuditRecord({
        requestId: normalizedRequestId,
        approval,
        action: normalizedAction,
        outcome: 'failed',
        user,
        device,
        error: failedState.error,
      }), uiAutomationResult));
      return {
        ok: false,
        httpStatus: 409,
        message: failedState.error,
        state: serializeActionState(failedState),
        pendingApprovals: ensureApprovalIncluded(
          (await getCurrentApprovalSnapshot(normalizedRequestId)).pendingApprovals,
          approval,
        ),
      };
    }

    const settleResult = await waitForApprovalToSettle(normalizedRequestId);
    if (!settleResult.cleared) {
      const notClearedError = buildNotClearedErrorMessage(normalizedAction, uiAutomationResult);
      const failedState = buildResolvedState({
        requestId: normalizedRequestId,
        approval,
        action: normalizedAction,
        status: 'failed',
        actedAt: actingState.actedAt,
        error: notClearedError,
      });
      actionStateByRequestId.set(normalizedRequestId, failedState);
      await appendAuditRecord(mergeAutomationDetails(buildAuditRecord({
        requestId: normalizedRequestId,
        approval,
        action: normalizedAction,
        outcome: 'failed',
        user,
        device,
        error: failedState.error,
      }), uiAutomationResult));
      return {
        ok: false,
        httpStatus: 409,
        message: failedState.error,
        state: serializeActionState(failedState),
        pendingApprovals: ensureApprovalIncluded(settleResult.pendingApprovals, approval),
      };
    }

    const finalState = buildResolvedState({
      requestId: normalizedRequestId,
      approval,
      action: normalizedAction,
      status: normalizedAction === 'approve' ? 'approved' : 'denied',
      actedAt: actingState.actedAt,
    });
    actionStateByRequestId.set(normalizedRequestId, finalState);
    await appendAuditRecord(mergeAutomationDetails(buildAuditRecord({
      requestId: normalizedRequestId,
      approval,
      action: normalizedAction,
      outcome: finalState.status,
      user,
      device,
    }), uiAutomationResult));
    return {
      ok: true,
      httpStatus: 200,
      message: normalizedAction === 'approve'
        ? 'Desktop approve button was clicked successfully.'
        : 'Desktop deny button was clicked successfully.',
      state: serializeActionState(finalState),
      pendingApprovals: await getPendingDesktopApprovals({ refresh: true }),
    };
  } catch (error) {
    const failedState = buildResolvedState({
      requestId: normalizedRequestId,
      approval,
      action: normalizedAction,
      status: 'failed',
      actedAt: actingState.actedAt,
      error: error?.message || 'Unknown bridge error',
    });
    actionStateByRequestId.set(normalizedRequestId, failedState);
    await appendAuditRecord(buildAuditRecord({
      requestId: normalizedRequestId,
      approval,
      action: normalizedAction,
      outcome: 'failed',
      user,
      device,
      error: failedState.error,
    }));
    return {
      ok: false,
      httpStatus: 500,
      message: failedState.error,
      state: serializeActionState(failedState),
      pendingApprovals: await getPendingDesktopApprovals({ refresh: true }),
    };
  }
}
