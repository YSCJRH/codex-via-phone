import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { isCodexSessionActive } from './openai-codex.js';

const CODEX_SESSIONS_ROOT = path.join(os.homedir(), '.codex', 'sessions');
const DESKTOP_APPROVAL_SCAN_INTERVAL_MS = 5000;
const DESKTOP_APPROVAL_MAX_FILES = 40;
const DESKTOP_APPROVAL_MAX_RESULTS = 12;
const DEFAULT_DESKTOP_APPROVAL_MAX_AGE_MS = 5 * 60 * 1000;
const parsedMaxAgeMs = Number.parseInt(process.env.MOBILE_CODEX_DESKTOP_APPROVAL_MAX_AGE_MS || '', 10);
const DESKTOP_APPROVAL_MAX_AGE_MS = Number.isFinite(parsedMaxAgeMs) && parsedMaxAgeMs > 0
  ? parsedMaxAgeMs
  : DEFAULT_DESKTOP_APPROVAL_MAX_AGE_MS;

let desktopApprovalCache = [];
let desktopApprovalSignature = '';
let scanPromise = null;
let monitorTimer = null;

function cloneSnapshot(items) {
  return JSON.parse(JSON.stringify(Array.isArray(items) ? items : []));
}

function parseDate(value, fallback = Date.now()) {
  const timestamp = new Date(value || fallback).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function extractTextParts(parts, allowedTypes) {
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .filter((part) => allowedTypes.has(part?.type) && typeof part?.text === 'string')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function extractUserFacingMessage(entry) {
  if (!entry || typeof entry !== 'object') {
    return '';
  }

  if (entry.type === 'event_msg' && entry.payload?.type === 'user_message' && typeof entry.payload.message === 'string') {
    return entry.payload.message.trim();
  }

  if (entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload.role === 'user') {
    return extractTextParts(entry.payload.content, new Set(['input_text', 'text']));
  }

  return '';
}

function parseEscalatedCall(entry) {
  if (entry?.type !== 'response_item' || entry.payload?.type !== 'function_call') {
    return null;
  }

  let parsedArguments = null;
  if (typeof entry.payload.arguments === 'string') {
    try {
      parsedArguments = JSON.parse(entry.payload.arguments);
    } catch {
      return null;
    }
  } else if (entry.payload.arguments && typeof entry.payload.arguments === 'object') {
    parsedArguments = entry.payload.arguments;
  }

  if (!parsedArguments || parsedArguments.sandbox_permissions !== 'require_escalated') {
    return null;
  }

  const callId = entry.payload.call_id || entry.payload.callId;
  if (!callId) {
    return null;
  }

  return {
    callId,
    toolName: typeof entry.payload.name === 'string' ? entry.payload.name : 'shell_command',
    command: typeof parsedArguments.command === 'string' ? parsedArguments.command.trim() : '',
    justification: typeof parsedArguments.justification === 'string' ? parsedArguments.justification.trim() : '',
    workdir: typeof parsedArguments.workdir === 'string' ? parsedArguments.workdir : null,
    prefixRule: Array.isArray(parsedArguments.prefix_rule) ? parsedArguments.prefix_rule : [],
    timestamp: entry.timestamp || null,
  };
}

function toProjectLabel(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    return null;
  }

  const normalized = projectPath.replace(/[\\/]+$/, '');
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function buildDesktopApprovalRecord(sessionMeta, call, lastUserMessage) {
  const sessionId = sessionMeta?.id || null;
  if (!sessionId) {
    return null;
  }

  if (!isCodexSessionActive(sessionId)) {
    return null;
  }

  const receivedAt = call.timestamp || sessionMeta?.timestamp || new Date().toISOString();
  const timestamp = parseDate(receivedAt);
  if (Date.now() - timestamp > DESKTOP_APPROVAL_MAX_AGE_MS) {
    return null;
  }

  const cwd = call.workdir || sessionMeta?.cwd || null;
  const projectLabel = toProjectLabel(cwd);
  const sessionSummary = typeof lastUserMessage === 'string' && lastUserMessage.trim()
    ? lastUserMessage.trim()
    : null;
  const bridgeSupported = Boolean(sessionId && call.callId && cwd);
  const title = projectLabel
    ? `Desktop approval required for ${projectLabel}`
    : 'Desktop approval required';
  const message = call.justification || 'Codex Desktop is waiting for command approval on the computer.';
  const requestId = `desktop-approval:${sessionId}:${call.callId}`;

  return {
    requestId,
    interactionId: requestId,
    provider: 'codex',
    kind: 'desktop-command-approval',
    toolName: call.toolName,
    title,
    message,
    input: call.command || null,
    sessionId,
    resolutionMode: 'desktop-only',
    receivedAt: new Date(timestamp).toISOString(),
    metadata: {
      source: 'codex-desktop-session-log',
      callId: call.callId,
      cwd,
      projectPath: cwd,
      command: call.command || null,
      prefixRule: call.prefixRule,
      projectLabel,
      sessionSummary,
      bridgeSupported,
      bridgeRequirement: bridgeSupported ? 'open-current-session' : 'desktop-only',
      sessionSource: sessionMeta?.source || null,
      sessionOriginator: sessionMeta?.originator || null,
    },
  };
}

async function findJsonlFiles(rootPath) {
  const filePaths = [];

  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        filePaths.push(...await findJsonlFiles(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        filePaths.push(fullPath);
      }
    }
  } catch {
    return [];
  }

  return filePaths;
}

async function getRecentSessionFiles() {
  try {
    await fs.access(CODEX_SESSIONS_ROOT);
  } catch {
    return [];
  }

  const filePaths = await findJsonlFiles(CODEX_SESSIONS_ROOT);
  const stats = await Promise.all(filePaths.map(async (filePath) => {
    try {
      const fileStats = await fs.stat(filePath);
      return {
        filePath,
        mtimeMs: fileStats.mtimeMs,
      };
    } catch {
      return null;
    }
  }));

  return stats
    .filter(Boolean)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, DESKTOP_APPROVAL_MAX_FILES);
}

async function parseDesktopApprovalsFromFile(filePath) {
  const pendingCalls = new Map();
  let sessionMeta = null;
  let lastUserMessage = null;

  const stream = fsSync.createReadStream(filePath);
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const rawLine of rl) {
      if (!rawLine.trim()) {
        continue;
      }

      let entry = null;
      try {
        entry = JSON.parse(rawLine);
      } catch {
        continue;
      }

      if (entry.type === 'session_meta' && entry.payload) {
        sessionMeta = entry.payload;
        continue;
      }

      const userMessage = extractUserFacingMessage(entry);
      if (userMessage) {
        lastUserMessage = userMessage;
      }

      const escalatedCall = parseEscalatedCall(entry);
      if (escalatedCall) {
        pendingCalls.set(escalatedCall.callId, escalatedCall);
        continue;
      }

      if (entry.type === 'response_item' && entry.payload?.type === 'function_call_output' && entry.payload.call_id) {
        pendingCalls.delete(entry.payload.call_id);
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return Array.from(pendingCalls.values())
    .map((call) => buildDesktopApprovalRecord(sessionMeta, call, lastUserMessage))
    .filter(Boolean);
}

function sortDesktopApprovals(items) {
  return [...items].sort((left, right) => (
    parseDate(right.receivedAt) - parseDate(left.receivedAt)
  ));
}

function buildSignature(items) {
  return JSON.stringify(
    items.map((item) => ({
      requestId: item.requestId,
      sessionId: item.sessionId,
      receivedAt: item.receivedAt,
      message: item.message,
      input: item.input,
    })),
  );
}

async function scanDesktopApprovals() {
  const recentFiles = await getRecentSessionFiles();
  const approvals = [];

  for (const file of recentFiles) {
    approvals.push(...await parseDesktopApprovalsFromFile(file.filePath));
  }

  return sortDesktopApprovals(approvals).slice(0, DESKTOP_APPROVAL_MAX_RESULTS);
}

async function refreshDesktopApprovalCache(force = false) {
  if (scanPromise) {
    return scanPromise;
  }

  scanPromise = (async () => {
    const approvals = await scanDesktopApprovals();
    const signature = buildSignature(approvals);
    const changed = signature !== desktopApprovalSignature;

    desktopApprovalCache = approvals;
    desktopApprovalSignature = signature;

    return {
      changed,
      approvals: cloneSnapshot(approvals),
    };
  })().finally(() => {
    scanPromise = null;
  });

  return scanPromise;
}

export async function getPendingDesktopApprovals(options = {}) {
  const { refresh = false } = options;

  if (refresh || desktopApprovalCache.length === 0) {
    const snapshot = await refreshDesktopApprovalCache(refresh);
    return snapshot.approvals;
  }

  return cloneSnapshot(desktopApprovalCache);
}

export async function getPendingDesktopApprovalsForSession(sessionId, options = {}) {
  if (!sessionId) {
    return [];
  }

  const approvals = await getPendingDesktopApprovals(options);
  return approvals.filter((item) => item.sessionId === sessionId);
}

export function startDesktopApprovalMonitor(onUpdate) {
  const emitIfChanged = async (force = false) => {
    try {
      const { approvals, changed } = await refreshDesktopApprovalCache(force);
      if ((changed || force) && typeof onUpdate === 'function') {
        onUpdate(approvals);
      }
    } catch (error) {
      console.error('[WARN] Desktop approval monitor refresh failed:', error);
    }
  };

  if (!monitorTimer) {
    void emitIfChanged(true);
    monitorTimer = setInterval(() => {
      void emitIfChanged(false);
    }, DESKTOP_APPROVAL_SCAN_INTERVAL_MS);
  }

  return () => {
    if (monitorTimer) {
      clearInterval(monitorTimer);
      monitorTimer = null;
    }
  };
}
