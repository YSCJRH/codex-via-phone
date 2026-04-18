import React, { useEffect, useMemo, useState } from 'react';
import { Clock3, Laptop, MessageSquareText, ShieldAlert } from 'lucide-react';
import type { PermissionPanelProps } from '../../configs/permissionPanelRegistry';

function formatRelativeTime(value?: string | null) {
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

export const DesktopInterventionPanel: React.FC<PermissionPanelProps> = ({
  request,
  onDecision,
}) => {
  const [mobileOverlayDismissed, setMobileOverlayDismissed] = useState(false);

  useEffect(() => {
    setMobileOverlayDismissed(false);
  }, [request.requestId]);

  const message = String(request.message || '').trim();
  const title = request.title || 'Desktop review required';
  const providerLabel = request.provider ? String(request.provider).toUpperCase() : 'UNKNOWN';
  const sessionLabel = request.sessionId ? String(request.sessionId) : null;
  const receivedAtLabel = useMemo(() => {
    if (!request.receivedAt) {
      return null;
    }

    const value = new Date(request.receivedAt);
    if (Number.isNaN(value.getTime())) {
      return null;
    }

    return value.toLocaleString();
  }, [request.receivedAt]);
  const receivedRelative = formatRelativeTime(request.receivedAt);

  const panelBody = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mobile-pill inline-flex h-11 w-11 flex-shrink-0 items-center justify-center text-amber-600 dark:text-amber-300">
            <Laptop className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="mobile-clamp-2 text-sm font-semibold text-foreground">{title}</div>
            <div className="mt-1 text-xs leading-5 mobile-subtle-text">
              This session needs a desktop-side confirmation before it can continue.
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="mobile-pill px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-primary">
            {providerLabel}
          </div>
          <div className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            Desktop only
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <div className="mobile-pill inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium text-foreground">
          <Clock3 className="h-3.5 w-3.5 text-primary" />
          {receivedRelative}
        </div>
        {sessionLabel && (
          <div className="mobile-pill inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium text-foreground">
            <MessageSquareText className="h-3.5 w-3.5 text-primary" />
            Thread linked
          </div>
        )}
      </div>

      {sessionLabel && (
        <div className="mt-3 rounded-2xl border border-border/45 bg-background/50 px-3 py-3 text-[12px] leading-5 text-foreground">
          <div className="text-[11px] font-medium uppercase tracking-[0.1em] mobile-muted-text">
            Session
          </div>
          <div className="mt-1 break-all font-mono text-[11px]">{sessionLabel}</div>
          {receivedAtLabel ? (
            <div className="mt-1 mobile-muted-text">Raised {receivedAtLabel}</div>
          ) : null}
        </div>
      )}

      {message && (
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-2xl border border-border/50 bg-muted/35 p-3 text-xs leading-5 text-foreground">
          {message}
        </pre>
      )}

      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            This prompt was raised by the desktop-hosted Codex runtime. Review it on the computer, then return to mobile after the desktop side continues or finishes.
          </span>
        </div>
      </div>
    </>
  );

  return (
    <>
      {!mobileOverlayDismissed && (
        <div className="mobile-sheet-backdrop fixed inset-0 z-[70] flex items-end justify-center p-4 sm:hidden">
          <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-border/50 bg-background/94 shadow-2xl backdrop-blur-xl">
            <div className="border-b border-border/40 bg-background/82 px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="mobile-pill inline-flex h-11 w-11 flex-shrink-0 items-center justify-center text-amber-600 dark:text-amber-300">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">Waiting for desktop approval</div>
                  <div className="mt-1 text-xs leading-5 mobile-subtle-text">
                    Your computer is paused on a Codex confirmation. Review the request below.
                  </div>
                </div>
              </div>
            </div>

            <div className="max-h-[65vh] overflow-auto px-4 py-4">
              {panelBody}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border/40 bg-background/78 px-4 py-3">
              <button
                type="button"
                onClick={() => setMobileOverlayDismissed(true)}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border/60 px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
              >
                Review on desktop
              </button>
              <button
                type="button"
                onClick={() =>
                  onDecision(request.requestId, {
                    action: 'dismiss',
                    message: 'User dismissed desktop-only review notice on mobile',
                  })
                }
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Dismiss reminder
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="hidden rounded-2xl border border-border/50 bg-background/82 p-4 shadow-sm backdrop-blur-sm sm:block">
        {panelBody}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              onDecision(request.requestId, {
                action: 'dismiss',
                message: 'User dismissed desktop-only review notice on mobile',
              })
            }
            className="inline-flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
          >
            Dismiss notice
          </button>
        </div>
      </div>
    </>
  );
};
