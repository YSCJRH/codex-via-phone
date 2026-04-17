/**
 * OpenAI Codex SDK Integration
 * =============================
 *
 * This module provides integration with the OpenAI Codex SDK for non-interactive
 * chat sessions. It mirrors the pattern used in claude-sdk.js for consistency.
 *
 * ## Usage
 *
 * - queryCodex(command, options, ws) - Execute a prompt with streaming via WebSocket
 * - abortCodexSession(sessionId) - Cancel an active session
 * - isCodexSessionActive(sessionId) - Check if a session is running
 * - getActiveCodexSessions() - List all active sessions
 */

import { Codex } from '@openai/codex-sdk';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import {
  listPendingInteractionsForSession,
  registerPendingInteraction,
  removePendingInteractionsForSession,
} from './pending-interactions.js';
import { resolveCodexSessionFilePath } from './projects.js';

// Track active sessions
const activeCodexSessions = new Map();
const CODEX_ONLY_HARDENED_MODE = process.env.CODEX_ONLY_HARDENED_MODE !== 'false';

const NON_ASCII_PATH_PATTERN = /[^\u0000-\u007F]/;
const SUPPRESSED_WARNING_PATTERNS = [
  'under-development features enabled:',
  'under-development features are incomplete and may behave unpredictably',
  'suppress_unsupported_features_warning'
];
const MANUAL_REVIEW_PATTERNS = [
  'allow me to run',
  'outside the repo',
  'approval',
  'permission',
  'requires user confirmation',
  'desktop intervention',
  'manual review',
];

function containsNonAscii(value) {
  return typeof value === 'string' && NON_ASCII_PATH_PATTERN.test(value);
}

function extractCodexMessage(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value.message === 'string') {
    return value.message;
  }

  return '';
}

function getCodexErrorText(error) {
  if (!error) {
    return '';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  if (typeof error.stderr === 'string' && error.stderr.trim()) {
    return error.stderr;
  }

  if (typeof error.stack === 'string' && error.stack.trim()) {
    return error.stack;
  }

  return String(error);
}

function isBrokenCodexResumeError(error) {
  const errorText = getCodexErrorText(error).toLowerCase();
  if (!errorText) {
    return false;
  }

  return errorText.includes('state db missing rollout path')
    || errorText.includes('failed to open state db')
    || errorText.includes('find_thread_path')
    || (errorText.includes('migration') && errorText.includes('missing'));
}

function isSuppressedCodexWarning(value) {
  const message = extractCodexMessage(value).toLowerCase();
  if (!message) {
    return false;
  }

  return SUPPRESSED_WARNING_PATTERNS.every((pattern) => message.includes(pattern))
    || message.includes('under-development features enabled:');
}

function shouldCreateManualReviewInteraction(value) {
  const message = extractCodexMessage(value).toLowerCase();
  if (!message) {
    return false;
  }

  return MANUAL_REVIEW_PATTERNS.some((pattern) => message.includes(pattern));
}

function queueDesktopReviewInteraction(ws, sessionId, value) {
  if (!sessionId || !shouldCreateManualReviewInteraction(value)) {
    return null;
  }

  const message = extractCodexMessage(value);
  const interaction = registerPendingInteraction({
    provider: 'codex',
    kind: 'manual-review',
    toolName: 'DesktopInterventionRequired',
    title: 'Desktop review required',
    message,
    sessionId,
    resolutionMode: 'desktop-only',
    receivedAt: new Date(),
    metadata: {
      provider: 'codex',
      source: 'codex-sdk',
    },
  });

  sendMessage(ws, {
    type: 'interaction-required',
    data: interaction,
    sessionId,
  });
  sendMessage(ws, {
    type: 'pending-permissions-response',
    sessionId,
    data: listPendingInteractionsForSession(sessionId),
  });

  return interaction;
}

function sendPendingInteractionsSnapshot(ws, sessionId) {
  if (!sessionId) {
    return;
  }

  sendMessage(ws, {
    type: 'pending-permissions-response',
    sessionId,
    data: listPendingInteractionsForSession(sessionId),
  });
}

function updateCodexSessionStatus(sessionId, nextStatus, metadata = {}) {
  const session = activeCodexSessions.get(sessionId);
  if (!session) {
    return null;
  }

  const previousStatus = session.status;
  Object.assign(session, metadata);

  if (nextStatus) {
    session.status = nextStatus;
  }

  if (session.status === 'completed' && !session.completedAt) {
    session.completedAt = new Date().toISOString();
  }

  if (session.status !== previousStatus || metadata.completionSource || metadata.lastTurnId) {
    console.log(
      `[CODEX_SESSION] ${sessionId} ${previousStatus} -> ${session.status}`
      + (session.completionSource ? ` (${session.completionSource})` : ''),
    );
  }

  return session;
}

function finalizeCodexSession(sessionId, writer, {
  status = 'completed',
  completionSource = 'stream-ended',
  lastTurnId = null,
  actualSessionId = null,
} = {}) {
  const session = updateCodexSessionStatus(sessionId, status, {
    completionSource,
    ...(lastTurnId ? { lastTurnId } : {}),
  });

  if (!session || session.status === 'aborted') {
    return session;
  }

  const targetWriter = writer || session.writer;
  const resolvedActualSessionId = actualSessionId || session.thread?.id || sessionId;

  if (status === 'completed') {
    removePendingInteractionsForSession(sessionId, { provider: 'codex' });
    sendPendingInteractionsSnapshot(targetWriter, sessionId);

    if (!session.completionNotified) {
      sendMessage(targetWriter, {
        type: 'codex-complete',
        sessionId,
        actualSessionId: resolvedActualSessionId,
        completionSource,
        lastTurnId: lastTurnId || session.lastTurnId || null,
      });
      session.completionNotified = true;
    }
  }

  return session;
}

function registerActiveCodexSession({
  sessionId,
  thread,
  codex,
  abortController,
  writer,
  workingDirectory,
  model,
  previousSessionId = null,
}) {
  activeCodexSessions.set(sessionId, {
    thread,
    codex,
    status: 'running',
    abortController,
    startedAt: new Date().toISOString(),
    writer,
    workingDirectory,
    model: model || null,
    completedAt: null,
    completionSource: null,
    completionNotified: false,
    lastTurnId: null,
  });

  if (writer?.setSessionId && typeof writer.setSessionId === 'function') {
    writer.setSessionId(sessionId);
  }

  removePendingInteractionsForSession(sessionId, { provider: 'codex' });

  sendMessage(writer, {
    type: 'session-created',
    sessionId,
    provider: 'codex',
    ...(previousSessionId ? {
      previousSessionId,
      recoveryReason: 'resume-failed-started-new-thread',
    } : {}),
  });
}

async function streamCodexThread({
  thread,
  command,
  sessionId,
  abortController,
  writer,
}) {
  const streamedTurn = await thread.runStreamed(command, {
    signal: abortController.signal
  });

  for await (const event of streamedTurn.events) {
    const session = activeCodexSessions.get(sessionId);
    if (!session || session.status === 'aborted' || session.status === 'completed' || session.status === 'failed') {
      break;
    }

    if (event.type === 'item.started' || event.type === 'item.updated') {
      continue;
    }

    const turnId = event.turn_id || event.turnId || null;
    if (turnId) {
      session.lastTurnId = turnId;
    }
    const resolvedTurnId = turnId || session.lastTurnId || null;

    if (event.type === 'turn.completed') {
      removePendingInteractionsForSession(sessionId, { provider: 'codex' });
      sendPendingInteractionsSnapshot(writer, sessionId);
    } else if (event.type === 'turn.failed') {
      queueDesktopReviewInteraction(writer, sessionId, event.error);
    } else if (event.type === 'error') {
      queueDesktopReviewInteraction(writer, sessionId, event.message);
    } else if (event.type === 'item.completed' && event.item?.type === 'error') {
      queueDesktopReviewInteraction(writer, sessionId, event.item?.message);
    }

    const transformed = transformCodexEvent(event);
    if (!transformed) {
      continue;
    }

    sendMessage(writer, {
      type: 'codex-response',
      data: transformed,
      sessionId
    });

    if (event.type === 'turn.completed' && event.usage) {
      const totalTokens = (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0);
      sendMessage(writer, {
        type: 'token-budget',
        data: {
          used: totalTokens,
          total: 200000
        },
        sessionId
      });
    }

    if (event.type === 'turn.completed' || event.type === 'task_complete') {
      await normalizeCodexRolloutTurnForDesktop(sessionId, resolvedTurnId);
      finalizeCodexSession(sessionId, writer, {
        status: 'completed',
        completionSource: event.type,
        lastTurnId: resolvedTurnId,
        actualSessionId: thread.id,
      });
      break;
    }

    if (event.type === 'turn.failed') {
      updateCodexSessionStatus(sessionId, 'failed', {
        completionSource: 'turn.failed',
        ...(resolvedTurnId ? { lastTurnId: resolvedTurnId } : {}),
      });
      break;
    }
  }
}

async function ensureAsciiWorkingDirectory(projectPath) {
  if (process.platform !== 'win32' || !containsNonAscii(projectPath)) {
    return projectPath;
  }

  const resolvedProjectPath = path.resolve(projectPath);
  const projectDriveRoot = path.parse(resolvedProjectPath).root || 'C:\\';
  const aliasRoot = path.join(projectDriveRoot, 'codex_project_aliases');
  const aliasName = crypto.createHash('sha1').update(resolvedProjectPath.toLowerCase()).digest('hex');
  const aliasPath = path.join(aliasRoot, aliasName);

  await fs.mkdir(aliasRoot, { recursive: true });

  try {
    const aliasStats = await fs.lstat(aliasPath);
    if (aliasStats.isDirectory() || aliasStats.isSymbolicLink()) {
      return aliasPath;
    }

    if (!aliasStats.isSymbolicLink() && !aliasStats.isDirectory()) {
      await fs.rm(aliasPath, { recursive: true, force: true });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.symlink(resolvedProjectPath, aliasPath, 'junction');
  return aliasPath;
}

function parseJsonlEntry(line) {
  if (typeof line !== 'string' || !line.trim()) {
    return null;
  }

  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function getJsonlTurnId(entry) {
  return entry?.payload?.turn_id || entry?.payload?.turnId || null;
}

function isJsonlUserResponseItem(entry) {
  return entry?.type === 'response_item'
    && entry?.payload?.type === 'message'
    && entry?.payload?.role === 'user';
}

function buildJsonlTurnWindows(lines) {
  const windows = [];
  let currentWindow = null;

  for (let index = 0; index < lines.length; index += 1) {
    const entry = parseJsonlEntry(lines[index]);
    if (entry?.type === 'event_msg' && entry?.payload?.type === 'task_started') {
      if (currentWindow) {
        currentWindow.endExclusive = index;
        windows.push(currentWindow);
      }

      currentWindow = {
        startIndex: index,
        endExclusive: lines.length,
        turnId: getJsonlTurnId(entry) || '',
      };
    }
  }

  if (currentWindow) {
    windows.push(currentWindow);
  }

  return windows;
}

function doesJsonlTurnWindowMatch(lines, window, preferredTurnId) {
  if (!window || !preferredTurnId) {
    return false;
  }

  if (window.turnId === preferredTurnId) {
    return true;
  }

  for (let index = window.startIndex; index < window.endExclusive; index += 1) {
    const entry = parseJsonlEntry(lines[index]);
    if (getJsonlTurnId(entry) === preferredTurnId) {
      return true;
    }
  }

  return false;
}

function getJsonlTurnNormalizationTarget(lines, window) {
  if (!window) {
    return null;
  }

  let turnContextIndex = -1;
  let userMessageIndex = -1;

  for (let index = window.startIndex; index < window.endExclusive; index += 1) {
    const entry = parseJsonlEntry(lines[index]);

    if (turnContextIndex < 0 && entry?.type === 'turn_context') {
      turnContextIndex = index;
      continue;
    }

    if (
      userMessageIndex < 0
      && entry?.type === 'event_msg'
      && entry?.payload?.type === 'user_message'
      && typeof entry?.payload?.message === 'string'
      && entry.payload.message.trim()
    ) {
      userMessageIndex = index;
    }
  }

  if (turnContextIndex < 0 || userMessageIndex < 0) {
    return null;
  }

  let insertionIndex = userMessageIndex;
  if (userMessageIndex > window.startIndex) {
    const maybeUserResponse = parseJsonlEntry(lines[userMessageIndex - 1]);
    if (isJsonlUserResponseItem(maybeUserResponse)) {
      insertionIndex = userMessageIndex - 1;
    }
  }

  return {
    turnContextIndex,
    insertionIndex,
    turnId: window.turnId || null,
  };
}

async function normalizeCodexRolloutTurnForDesktop(sessionId, turnId) {
  const safeSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const safeTurnId = typeof turnId === 'string' ? turnId.trim() : '';
  if (!safeSessionId) {
    return false;
  }

  const rolloutPath = await resolveCodexSessionFilePath(safeSessionId);
  if (!rolloutPath) {
    return false;
  }

  let fileContent;
  try {
    fileContent = await fs.readFile(rolloutPath, 'utf8');
  } catch (error) {
    console.warn(`[CODEX_SESSION] Failed to read rollout for normalization ${safeSessionId}:`, error.message);
    return false;
  }

  const hasTrailingNewline = fileContent.endsWith('\n');
  const lines = fileContent.split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) {
    return false;
  }

  const windows = buildJsonlTurnWindows(lines);
  if (!windows.length) {
    return false;
  }

  let targetWindow = null;
  if (safeTurnId) {
    targetWindow = windows.find((window) => doesJsonlTurnWindowMatch(lines, window, safeTurnId)) || null;
  }

  let target = targetWindow ? getJsonlTurnNormalizationTarget(lines, targetWindow) : null;

  if (!target) {
    for (let index = windows.length - 1; index >= 0; index -= 1) {
      const candidate = getJsonlTurnNormalizationTarget(lines, windows[index]);
      if (candidate) {
        targetWindow = windows[index];
        target = candidate;
        break;
      }
    }
  }

  if (!target || !targetWindow) {
    return false;
  }

  if (target.turnContextIndex <= target.insertionIndex) {
    return false;
  }

  const [turnContextLine] = lines.splice(target.turnContextIndex, 1);
  lines.splice(target.insertionIndex, 0, turnContextLine);

  const normalizedContent = lines.join('\n') + (hasTrailingNewline || lines.length ? '\n' : '');
  if (normalizedContent === fileContent) {
    return false;
  }

  try {
    await fs.writeFile(rolloutPath, normalizedContent, 'utf8');
    const normalizedTurnId = target.turnId || safeTurnId || 'latest';
    const normalizationMode = safeTurnId && normalizedTurnId === safeTurnId ? 'turn' : 'latest turn';
    console.log(`[CODEX_SESSION] Normalized rollout ${normalizationMode} ${normalizedTurnId} for ${safeSessionId}`);
    return true;
  } catch (error) {
    console.warn(`[CODEX_SESSION] Failed to normalize rollout for ${safeSessionId}:`, error.message);
    return false;
  }
}

/**
 * Transform Codex SDK event to WebSocket message format
 * @param {object} event - SDK event
 * @returns {object} - Transformed event for WebSocket
 */
function transformCodexEvent(event) {
  // Map SDK event types to a consistent format
  switch (event.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      const item = event.item;
      if (!item) {
        return { type: event.type, item: null };
      }

      // Transform based on item type
      switch (item.type) {
        case 'agent_message':
          return {
            type: 'item',
            itemType: 'agent_message',
            message: {
              role: 'assistant',
              content: item.text
            }
          };

        case 'reasoning':
          return {
            type: 'item',
            itemType: 'reasoning',
            message: {
              role: 'assistant',
              content: item.text,
              isReasoning: true
            }
          };

        case 'command_execution':
          return {
            type: 'item',
            itemType: 'command_execution',
            command: item.command,
            output: item.aggregated_output,
            exitCode: item.exit_code,
            status: item.status
          };

        case 'file_change':
          return {
            type: 'item',
            itemType: 'file_change',
            changes: item.changes,
            status: item.status
          };

        case 'mcp_tool_call':
          return {
            type: 'item',
            itemType: 'mcp_tool_call',
            server: item.server,
            tool: item.tool,
            arguments: item.arguments,
            result: item.result,
            error: item.error,
            status: item.status
          };

        case 'web_search':
          return {
            type: 'item',
            itemType: 'web_search',
            query: item.query
          };

        case 'todo_list':
          return {
            type: 'item',
            itemType: 'todo_list',
            items: item.items
          };

        case 'error':
          if (isSuppressedCodexWarning(item.message)) {
            return null;
          }

          return {
            type: 'item',
            itemType: 'error',
            message: {
              role: 'error',
              content: item.message
            }
          };

        default:
          return {
            type: 'item',
            itemType: item.type,
            item: item
          };
      }

    case 'turn.started':
      return {
        type: 'turn_started'
      };

    case 'turn.completed':
      return {
        type: 'turn_complete',
        usage: event.usage
      };

    case 'task_complete':
      return {
        type: 'task_complete',
        turnId: event.turn_id || event.turnId || null,
        lastAgentMessage: event.last_agent_message || event.lastAgentMessage || null,
      };

    case 'turn.failed':
      if (isSuppressedCodexWarning(event.error)) {
        return null;
      }

      return {
        type: 'turn_failed',
        error: event.error
      };

    case 'thread.started':
      return {
        type: 'thread_started',
        threadId: event.id
      };

    case 'error':
      if (isSuppressedCodexWarning(event.message)) {
        return null;
      }

      return {
        type: 'error',
        message: event.message
      };

    default:
      return {
        type: event.type,
        data: event
      };
  }
}

/**
 * Map permission mode to Codex SDK options
 * @param {string} permissionMode - 'default', 'acceptEdits', or 'bypassPermissions'
 * @returns {object} - { sandboxMode, approvalPolicy }
 */
function mapPermissionModeToCodexOptions(permissionMode) {
  const normalizedPermissionMode =
    permissionMode === 'bypassPermissions' ? 'acceptEdits' : permissionMode;

  switch (normalizedPermissionMode) {
    case 'acceptEdits':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never'
      };
    case 'default':
    default:
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: CODEX_ONLY_HARDENED_MODE ? 'never' : 'untrusted'
      };
  }
}

/**
 * Execute a Codex query with streaming
 * @param {string} command - The prompt to send
 * @param {object} options - Options including cwd, sessionId, model, permissionMode
 * @param {WebSocket|object} ws - WebSocket connection or response writer
 */
export async function queryCodex(command, options = {}, ws) {
  const {
    sessionId,
    cwd,
    projectPath,
    model,
    permissionMode = 'default'
  } = options;

  const requestedWorkingDirectory = cwd || projectPath || process.cwd();
  const workingDirectory = await ensureAsciiWorkingDirectory(requestedWorkingDirectory);
  if (workingDirectory !== requestedWorkingDirectory) {
    console.log('[Codex] Using ASCII working directory alias:', workingDirectory, 'for', requestedWorkingDirectory);
  }
  const { sandboxMode, approvalPolicy } = mapPermissionModeToCodexOptions(permissionMode);

  let codex;
  let thread;
  let currentSessionId = sessionId;
  const abortController = new AbortController();

  try {
    // Initialize Codex SDK
    codex = new Codex();

    // Thread options with sandbox and approval settings
    const threadOptions = {
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode,
      approvalPolicy,
      model
    };

    let attemptedResume = false;

    // Start or resume thread
    if (sessionId) {
      attemptedResume = true;
      thread = codex.resumeThread(sessionId, threadOptions);
    } else {
      thread = codex.startThread(threadOptions);
    }

    currentSessionId = thread.id || sessionId || `codex-${Date.now()}`;
    registerActiveCodexSession({
      sessionId: currentSessionId,
      thread,
      codex,
      abortController,
      writer: ws,
      workingDirectory,
      model,
    });

    try {
      await streamCodexThread({
        thread,
        command,
        sessionId: currentSessionId,
        abortController,
        writer: ws,
      });
    } catch (initialError) {
      if (!attemptedResume || !sessionId || !isBrokenCodexResumeError(initialError)) {
        throw initialError;
      }

      console.warn(`[Codex] Resume failed for ${sessionId}; starting a fresh thread instead.`);
      console.warn('[Codex] Resume failure details:', getCodexErrorText(initialError));

      activeCodexSessions.delete(currentSessionId);
      removePendingInteractionsForSession(currentSessionId, { provider: 'codex' });

      thread = codex.startThread(threadOptions);
      currentSessionId = thread.id || `codex-${Date.now()}`;

      registerActiveCodexSession({
        sessionId: currentSessionId,
        thread,
        codex,
        abortController,
        writer: ws,
        workingDirectory,
        model,
        previousSessionId: sessionId,
      });
      await streamCodexThread({
        thread,
        command,
        sessionId: currentSessionId,
        abortController,
        writer: ws,
      });
    }

    const session = currentSessionId ? activeCodexSessions.get(currentSessionId) : null;
    if (currentSessionId && session?.status === 'running') {
      finalizeCodexSession(currentSessionId, ws, {
        status: 'completed',
        completionSource: 'stream-ended',
        actualSessionId: thread.id,
      });
    }

  } catch (error) {
    const session = currentSessionId ? activeCodexSessions.get(currentSessionId) : null;
    const wasAborted =
      session?.status === 'aborted' ||
      error?.name === 'AbortError' ||
      String(error?.message || '').toLowerCase().includes('aborted');

    if (!wasAborted) {
      if (currentSessionId) {
        updateCodexSessionStatus(currentSessionId, 'failed', {
          completionSource: 'query-error',
        });
      }
      console.error('[Codex] Error:', error);
      queueDesktopReviewInteraction(ws, currentSessionId, error?.message || error);
      sendMessage(ws, {
        type: 'codex-error',
        error: error.message,
        sessionId: currentSessionId
      });
    }

  } finally {
    if (currentSessionId) {
      const session = activeCodexSessions.get(currentSessionId);
      if (session?.status === 'running') {
        updateCodexSessionStatus(currentSessionId, 'completed', {
          completionSource: session.completionSource || 'finally',
        });
      }
      if (activeCodexSessions.get(currentSessionId)?.status === 'aborted') {
        removePendingInteractionsForSession(currentSessionId, { provider: 'codex' });
      }
    }
  }
}

/**
 * Abort an active Codex session
 * @param {string} sessionId - Session ID to abort
 * @returns {boolean} - Whether abort was successful
 */
export function abortCodexSession(sessionId) {
  const session = activeCodexSessions.get(sessionId);

  if (!session) {
    return false;
  }

  if (session.status === 'completed' || session.status === 'failed' || session.status === 'aborted') {
    console.log(`[CODEX_SESSION] Abort acknowledged for terminal session ${sessionId} (${session.status})`);
    removePendingInteractionsForSession(sessionId, { provider: 'codex' });
    return true;
  }

  updateCodexSessionStatus(sessionId, 'aborted', {
    completionSource: session.completionSource || 'user-abort',
  });
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Codex] Failed to abort session ${sessionId}:`, error);
  }

  removePendingInteractionsForSession(sessionId, { provider: 'codex' });

  return true;
}

/**
 * Check if a session is active
 * @param {string} sessionId - Session ID to check
 * @returns {boolean} - Whether session is active
 */
export function isCodexSessionActive(sessionId) {
  const session = activeCodexSessions.get(sessionId);
  return session?.status === 'running';
}

/**
 * Reconnect a running Codex session writer to a new raw WebSocket.
 * Mirrors the Claude SDK reconnection flow so mobile clients can resume
 * streaming after Safari temporarily drops the socket.
 * @param {string} sessionId - Session ID
 * @param {Object} newRawWs - Replacement raw WebSocket connection
 * @returns {boolean} - Whether reconnection succeeded
 */
export function reconnectCodexSessionWriter(sessionId, newRawWs) {
  const session = activeCodexSessions.get(sessionId);
  if (!session?.writer?.updateWebSocket) {
    return false;
  }

  if (session.status !== 'running') {
    console.log(`[RECONNECT] Suppressed writer swap for terminal Codex session ${sessionId} (${session.status})`);
    return false;
  }

  session.writer.updateWebSocket(newRawWs);
  sendPendingInteractionsSnapshot(session.writer, sessionId);
  console.log(`[RECONNECT] Codex writer swapped for session ${sessionId}`);
  return true;
}

export function getActiveCodexSessionContext(sessionId) {
  const session = activeCodexSessions.get(sessionId);
  if (!session) {
    return null;
  }

  return {
    status: session.status,
    writer: session.writer || null,
    workingDirectory: session.workingDirectory || null,
    model: session.model || null,
    startedAt: session.startedAt || null,
    completedAt: session.completedAt || null,
    completionSource: session.completionSource || null,
    lastTurnId: session.lastTurnId || null,
  };
}

/**
 * Get all active sessions
 * @returns {Array} - Array of active session info
 */
export function getActiveCodexSessions() {
  const sessions = [];

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status === 'running') {
      sessions.push({
        id,
        status: session.status,
        startedAt: session.startedAt
      });
    }
  }

  return sessions;
}

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      // Writer handles stringification (SSEStreamWriter or WebSocketWriter)
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      // Raw WebSocket - stringify here
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

// Clean up old completed sessions periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes
