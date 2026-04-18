import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Laptop,
  Link2,
  MessageSquareText,
  ShieldCheck,
} from 'lucide-react';
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

function formatRelativeTime(value: PendingPermissionRequest['receivedAt']) {
  if (!value) {
    return 'just now';
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return 'just now';
  }

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp.getTime()) / 60000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  if (diffMinutes < 24 * 60) return `${Math.round(diffMinutes / 60)} hr ago`;
  return `${Math.round(diffMinutes / (60 * 24))} d ago`;
}

function describeBridgeStatus(bridgeStatus?: DesktopApprovalBridgeStatus | null) {
  if (!bridgeStatus) {
    return {
      level: 'warning',
      label: 'Checking bridge',
      message: 'Checking whether the computer has remote desktop approvals enabled...',
    };
  }

  if (bridgeStatus.active) {
    const untilText = bridgeStatus.enabledUntil ? formatTimestamp(bridgeStatus.enabledUntil) : null;
    return {
      level: 'success',
      label: 'Bridge ready',
      message: untilText
        ? `Remote approve-once is enabled on the computer until ${untilText}.`
        : 'Remote approve-once is enabled on the computer.',
    };
  }

  return {
    level: 'warning',
    label: 'Desktop only',
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

function getAvailabilityState({
  request,
  bridgeStatus,
  currentSessionId,
}: {
  request: PendingPermissionRequest;
  bridgeStatus?: DesktopApprovalBridgeStatus | null;
  currentSessionId?: string | null;
}) {
  const hasSession = typeof request.sessionId === 'string' && request.sessionId.trim().length > 0;
  const bridgeSupported = request.metadata?.bridgeSupported === true;
  const bridgeActive = Boolean(bridgeStatus?.active);
  const isReviewingSession = hasSession && currentSessionId === request.sessionId;
  const canBridge = bridgeSupported && bridgeActive && isReviewingSession;

  if (canBridge) {
    return {
      canBridge,
      tone: 'success',
      label: 'Ready on mobile',
      message: 'Approve once or deny can be sent back into this Codex session from mobile.',
    };
  }

  if (!bridgeSupported) {
    return {
      canBridge,
      tone: 'warning',
      label: 'Desktop review',
      message: 'This desktop prompt is visible on mobile, but it still has to be reviewed on the computer.',
    };
  }

  if (!bridgeActive) {
    return {
      canBridge,
      tone: 'warning',
      label: 'Bridge inactive',
      message: bridgeStatus?.message || 'Enable remote desktop approvals on the computer first.',
    };
  }

  if (hasSession && !isReviewingSession) {
    return {
      canBridge,
      tone: 'info',
      label: 'Open matching thread',
      message: 'Open this exact thread on mobile before sending approve-once or deny.',
    };
  }

  return {
    canBridge,
    tone: 'warning',
    label: 'Desktop review',
    message: 'Approval still needs to be completed on the computer.',
  };
}

function toneClasses(tone: 'success' | 'warning' | 'info') {
  if (tone === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200';
  }
  if (tone === 'info') {
    return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200';
  }
  return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200';
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
  const receivedRelative = formatRelativeTime(request.receivedAt);
  const projectLabel = getProjectLabel(request);
  const commandText = getCommandText(request);
  const actionState = actionStateByRequestId?.[request.requestId];
  const isResolving = Boolean(actionState?.pending);
  const isWaitingOnDesktop = Boolean(actionState?.waitingOnDesktop);
  const availability = getAvailabilityState({ request, bridgeStatus, currentSessionId });
  const isBridgeCard = request.metadata?.bridgeSupported === true;

  return (
    <div className="mobile-card mobile-shadow p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`mobile-pill inline-flex h-11 w-11 flex-shrink-0 items-center justify-center ${
            availability.tone === 'success'
              ? 'text-emerald-600 dark:text-emerald-300'
              : availability.tone === 'info'
                ? 'text-sky-600 dark:text-sky-300'
                : 'text-amber-600 dark:text-amber-300'
          }`}>
            {availability.tone === 'success' ? (
              <ShieldCheck className="h-5 w-5" />
            ) : availability.tone === 'info' ? (
              <Link2 className="h-5 w-5" />
            ) : (
              <Laptop className="h-5 w-5" />
            )}
          </div>

          <div className="min-w-0">
            <div className="mobile-clamp-2 text-sm font-semibold text-foreground">
              {request.title || 'Desktop approval required'}
            </div>
            <div className="mt-1 text-xs leading-5 mobile-subtle-text">
              {availability.message}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            isBridgeCard ? 'bg-primary/12 text-primary' : 'bg-foreground/7 text-foreground/70'
          }`}>
            {isBridgeCard ? 'Bridge' : 'Desktop'}
          </div>
          <div className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${toneClasses(availability.tone)}`}>
            {availability.label}
          </div>
        </div>
      </div>

      {(projectLabel || receivedAt || request.sessionId) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {projectLabel && (
            <div className="mobile-pill px-3 py-1 text-[11px] font-medium text-foreground">
              Project {projectLabel}
            </div>
          )}
          <div className="mobile-pill mobile-tabular inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium text-foreground">
            <Clock3 className="h-3.5 w-3.5 text-primary" />
            {receivedRelative}
          </div>
          {request.sessionId && (
            <div className="mobile-pill inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium text-foreground">
              <MessageSquareText className="h-3.5 w-3.5 text-primary" />
              Thread linked
            </div>
          )}
        </div>
      )}

      {request.sessionId && (
        <div className="mt-3 rounded-2xl border border-border/45 bg-background/50 px-3 py-3 text-[12px] leading-5 text-foreground">
          <div className="text-[11px] font-medium uppercase tracking-[0.1em] mobile-muted-text">
            Session
          </div>
          <div className="mt-1 break-all font-mono text-[11px]">
            {request.sessionId}
          </div>
          {receivedAt ? (
            <div className="mt-1 mobile-muted-text">
              Raised {receivedAt}
            </div>
          ) : null}
        </div>
      )}

      {request.message && (
        <div className="mt-3 rounded-2xl border border-border/50 bg-muted/35 px-3 py-3 text-xs leading-5 text-foreground">
          {request.message}
        </div>
      )}

      {commandText && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-950 text-slate-50 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800/70 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-slate-400">
            <span>Pending command</span>
            <span>{isResolving ? 'sending' : 'review'}</span>
          </div>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap px-3 py-3 text-[11px] leading-5">
            {commandText}
          </pre>
        </div>
      )}

      {actionState?.error && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
          {actionState.error}
        </div>
      )}

      {actionState?.success && (
        <div className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${
          isWaitingOnDesktop
            ? toneClasses('warning')
            : toneClasses('success')
        }`}>
          <div className="flex items-start gap-2">
            {isWaitingOnDesktop ? (
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
            )}
            <span>{actionState.success}</span>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {availability.canBridge && !isWaitingOnDesktop && (
          <>
            <button
              type="button"
              onClick={() => onResolve(request.requestId, 'approve')}
              disabled={isResolving || !availability.canBridge}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isResolving ? 'Sending...' : 'Approve once'}
            </button>
            <button
              type="button"
              onClick={() => onResolve(request.requestId, 'deny')}
              disabled={isResolving || !availability.canBridge}
              className="inline-flex flex-1 items-center justify-center rounded-xl border border-rose-300 bg-background px-3 py-2.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-900/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isResolving ? 'Sending...' : 'Deny'}
            </button>
          </>
        )}
        {request.sessionId && (
          <button
            type="button"
            onClick={() => onOpenSession(request.requestId, request.sessionId as string)}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
          >
            <MessageSquareText className="h-4 w-4" />
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
  const bridgeSummaryClasses = toneClasses(bridgeSummary.level);

  return (
    <>
      <div className="mobile-sheet-backdrop fixed inset-0 z-[80] sm:hidden" />
      <div className="fixed inset-x-0 bottom-0 z-[90] px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-4 sm:hidden">
        <div className="mobile-sheet-panel mx-auto max-w-lg overflow-hidden rounded-t-[30px]">
          <div className="border-b border-border/40 bg-background/72 px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="mobile-pill inline-flex h-11 w-11 flex-shrink-0 items-center justify-center text-primary">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">
                  {requests.length === 1 ? '1 desktop approval is waiting' : `${requests.length} desktop approvals are waiting`}
                </div>
                <div className="mt-1 text-xs leading-5 mobile-subtle-text">
                  We mirrored the desktop prompt here so you do not miss it while away from the computer.
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${bridgeSummaryClasses}`}>
                    {bridgeSummary.label}
                  </span>
                  {currentSessionId ? (
                    <span className="mobile-pill inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium text-foreground">
                      <MessageSquareText className="h-3.5 w-3.5 text-primary" />
                      Active thread selected
                    </span>
                  ) : null}
                </div>
                <div className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${bridgeSummaryClasses}`}>
                  {bridgeSummary.message}
                </div>
              </div>
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
            <div className="flex items-start gap-3">
              <div className="mobile-pill inline-flex h-11 w-11 flex-shrink-0 items-center justify-center text-primary">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">Desktop approvals waiting</div>
                <div className="mt-1 text-xs leading-5 mobile-subtle-text">
                  Mobile can now send approve-once or deny back into the same Codex session.
                </div>
                <div className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${bridgeSummaryClasses}`}>
                  {bridgeSummary.message}
                </div>
              </div>
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
