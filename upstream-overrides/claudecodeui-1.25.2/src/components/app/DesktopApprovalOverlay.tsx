import React from 'react';
import type { PendingPermissionRequest } from '../chat/types/types';

type DesktopApprovalAction = 'approve' | 'deny';
export type DesktopApprovalBridgeStatus = {
  enabled: boolean;
  active: boolean;
  enabledAt?: string | null;
  enabledUntil?: string | null;
  reason?: string | null;
  maxAgeMs?: number;
  message?: string | null;
};

type DesktopApprovalOverlayProps = {
  requests: PendingPermissionRequest[];
  bridgeStatus?: DesktopApprovalBridgeStatus | null;
  currentSessionId?: string | null;
  onDismiss: (requestId: string) => void;
  onDismissAll: () => void;
  onOpenSession: (requestId: string, sessionId: string) => void;
  onResolve: (requestId: string, action: DesktopApprovalAction) => void;
  actionStateByRequestId?: Record<string, { pending?: boolean; error?: string | null; success?: string | null; waitingOnDesktop?: boolean }>;
};

function formatTimestamp(value: PendingPermissionRequest['receivedAt']) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return timestamp.toLocaleString();
}

function describeBridgeStatus(bridgeStatus?: DesktopApprovalBridgeStatus | null) {
  if (!bridgeStatus) {
    return {
      level: 'warning',
      message: 'Checking whether the computer has remote desktop approvals enabled...',
    };
  }

  if (bridgeStatus.active) {
    const untilText = bridgeStatus.enabledUntil ? formatTimestamp(bridgeStatus.enabledUntil) : null;
    return {
      level: 'success',
      message: untilText
        ? `Remote approve-once is enabled on the computer until ${untilText}.`
        : 'Remote approve-once is enabled on the computer.',
    };
  }

  return {
    level: 'warning',
    message: bridgeStatus.message || 'Enable remote desktop approvals on the computer first.',
  };
}

function getProjectLabel(request: PendingPermissionRequest) {
  const rawPath = typeof request.metadata?.cwd === 'string'
    ? request.metadata.cwd
    : typeof request.metadata?.projectLabel === 'string'
      ? request.metadata.projectLabel
      : null;

  if (!rawPath) {
    return null;
  }

  const segments = rawPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || rawPath;
}

function getCommandText(request: PendingPermissionRequest) {
  if (typeof request.input === 'string' && request.input.trim()) {
    return request.input.trim();
  }

  if (typeof request.metadata?.command === 'string' && request.metadata.command.trim()) {
    return request.metadata.command.trim();
  }

  return null;
}

function ApprovalCard({
  request,
  bridgeStatus,
  currentSessionId,
  onDismiss,
  onOpenSession,
  onResolve,
  actionStateByRequestId,
}: {
  request: PendingPermissionRequest;
  bridgeStatus?: DesktopApprovalBridgeStatus | null;
  currentSessionId?: string | null;
  onDismiss: (requestId: string) => void;
  onOpenSession: (requestId: string, sessionId: string) => void;
  onResolve: (requestId: string, action: DesktopApprovalAction) => void;
  actionStateByRequestId?: Record<string, { pending?: boolean; error?: string | null; success?: string | null; waitingOnDesktop?: boolean }>;
}) {
  const receivedAt = formatTimestamp(request.receivedAt);
  const projectLabel = getProjectLabel(request);
  const commandText = getCommandText(request);
  const actionState = actionStateByRequestId?.[request.requestId];
  const isResolving = Boolean(actionState?.pending);
  const isWaitingOnDesktop = Boolean(actionState?.waitingOnDesktop);
  const hasSession = typeof request.sessionId === 'string' && request.sessionId.trim().length > 0;
  const bridgeSupported = request.metadata?.bridgeSupported === true;
  const bridgeActive = Boolean(bridgeStatus?.active);
  const isReviewingSession = hasSession && currentSessionId === request.sessionId;
  const canBridge = bridgeSupported && bridgeActive && isReviewingSession;
  const availabilityMessage = canBridge
    ? 'Approve once or deny can be sent back into this Codex session from mobile.'
    : !bridgeSupported
      ? 'This desktop prompt is visible on mobile, but it still has to be reviewed on the computer.'
      : !bridgeActive
        ? (bridgeStatus?.message || 'Enable remote desktop approvals on the computer first.')
      : hasSession && !isReviewingSession
        ? 'Open this exact thread on mobile before sending approve-once or deny.'
      : hasSession
          ? 'Open this exact thread on mobile before sending approve-once or deny.'
          : 'Approval still needs to be completed on the computer.';

  return (
    <div className="mobile-card mobile-shadow p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">
            {request.title || 'Desktop approval required'}
          </div>
          <div className="mt-1 text-xs mobile-subtle-text">
            {availabilityMessage}
          </div>
        </div>
        <div className="mobile-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
          {bridgeSupported ? 'Bridge' : 'Desktop'}
        </div>
      </div>

      {(projectLabel || receivedAt || request.sessionId) && (
        <div className="mt-3 grid gap-1 text-xs mobile-muted-text">
          {projectLabel && <div>Project: {projectLabel}</div>}
          {receivedAt && <div>Raised: {receivedAt}</div>}
          {request.sessionId && (
            <div className="break-all">
              Session: <span className="font-mono text-[11px] text-foreground">{request.sessionId}</span>
            </div>
          )}
        </div>
      )}

      {request.message && (
        <div className="mt-3 rounded-2xl border border-border/50 bg-muted/35 px-3 py-2 text-xs leading-5 text-foreground">
          {request.message}
        </div>
      )}

      {commandText && (
        <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-2xl border border-border/50 bg-slate-950 px-3 py-2 text-[11px] leading-5 text-slate-50 dark:bg-slate-900">
          {commandText}
        </pre>
      )}

      {actionState?.error && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
          {actionState.error}
        </div>
      )}

      {actionState?.success && (
        <div
          className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${
            isWaitingOnDesktop
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {actionState.success}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canBridge && !isWaitingOnDesktop && (
          <>
            <button
              type="button"
              onClick={() => onResolve(request.requestId, 'approve')}
              disabled={isResolving || !canBridge}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isResolving ? 'Sending...' : 'Approve once'}
            </button>
            <button
              type="button"
              onClick={() => onResolve(request.requestId, 'deny')}
              disabled={isResolving || !canBridge}
              className="inline-flex flex-1 items-center justify-center rounded-xl border border-rose-300 bg-background px-3 py-2.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isResolving ? 'Sending...' : 'Deny'}
            </button>
          </>
        )}
        {request.sessionId && (
          <button
            type="button"
            onClick={() => onOpenSession(request.requestId, request.sessionId as string)}
            className="inline-flex flex-1 items-center justify-center rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Open thread
          </button>
        )}
        <button
          type="button"
          onClick={() => onDismiss(request.requestId)}
          className="inline-flex flex-1 items-center justify-center rounded-xl border border-border/60 px-3 py-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/50"
        >
          Dismiss for now
        </button>
      </div>
    </div>
  );
}

export default function DesktopApprovalOverlay({
  requests,
  bridgeStatus,
  currentSessionId,
  onDismiss,
  onDismissAll,
  onOpenSession,
  onResolve,
  actionStateByRequestId,
}: DesktopApprovalOverlayProps) {
  if (!requests.length) {
    return null;
  }

  const bridgeSummary = describeBridgeStatus(bridgeStatus);
  const bridgeSummaryClasses = bridgeSummary.level === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200';

  return (
    <>
      <div className="mobile-sheet-backdrop fixed inset-0 z-[80] sm:hidden" />
      <div className="fixed inset-x-0 bottom-0 z-[90] px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-4 sm:hidden">
        <div className="mobile-sheet-panel mx-auto max-w-lg overflow-hidden rounded-t-[30px]">
          <div className="border-b border-border/40 bg-background/72 px-4 py-4">
            <div className="text-sm font-semibold text-foreground">
              {requests.length === 1 ? '1 desktop approval is waiting' : `${requests.length} desktop approvals are waiting`}
            </div>
            <div className="mt-1 text-xs mobile-subtle-text">
              We mirrored the desktop prompt here so you do not miss it while away from the computer.
            </div>
            <div className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${bridgeSummaryClasses}`}>
              {bridgeSummary.message}
            </div>
          </div>

          <div className="max-h-[70vh] space-y-3 overflow-auto px-4 py-4">
            {requests.map((request) => (
              <ApprovalCard
                key={request.requestId}
                request={request}
                bridgeStatus={bridgeStatus}
                currentSessionId={currentSessionId}
                onDismiss={onDismiss}
                onOpenSession={onOpenSession}
                onResolve={onResolve}
                actionStateByRequestId={actionStateByRequestId}
              />
            ))}
          </div>

          <div className="border-t border-border/40 bg-background/75 px-4 py-3">
            <button
              type="button"
              onClick={onDismissAll}
              className="inline-flex w-full items-center justify-center rounded-xl border border-border/60 px-3 py-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/50"
            >
              Dismiss all for now
            </button>
          </div>
        </div>
      </div>

      <div className="pointer-events-none fixed right-4 top-4 z-[90] hidden w-full max-w-sm sm:block">
        <div className="pointer-events-auto overflow-hidden rounded-2xl border border-border/50 bg-background/90 shadow-2xl backdrop-blur-xl">
          <div className="border-b border-border/40 bg-background/90 px-4 py-4">
            <div className="text-sm font-semibold text-foreground">Desktop approvals waiting</div>
            <div className="mt-1 text-xs mobile-subtle-text">
              Mobile can now send approve-once or deny back into the same Codex session.
            </div>
            <div className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${bridgeSummaryClasses}`}>
              {bridgeSummary.message}
            </div>
          </div>

          <div className="max-h-[75vh] space-y-3 overflow-auto px-4 py-4">
            {requests.map((request) => (
              <ApprovalCard
                key={request.requestId}
                request={request}
                bridgeStatus={bridgeStatus}
                currentSessionId={currentSessionId}
                onDismiss={onDismiss}
                onOpenSession={onOpenSession}
                onResolve={onResolve}
                actionStateByRequestId={actionStateByRequestId}
              />
            ))}
          </div>

          <div className="border-t border-border/40 bg-background/90 px-4 py-3">
            <button
              type="button"
              onClick={onDismissAll}
              className="inline-flex w-full items-center justify-center rounded-xl border border-border/60 px-3 py-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/50"
            >
              Dismiss all for now
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
