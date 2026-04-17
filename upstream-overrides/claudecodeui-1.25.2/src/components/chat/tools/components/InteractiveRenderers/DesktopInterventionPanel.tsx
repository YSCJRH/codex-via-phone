import React, { useEffect, useMemo, useState } from 'react';
import type { PermissionPanelProps } from '../../configs/permissionPanelRegistry';

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

  const panelBody = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-xs mobile-subtle-text">
            This session needs a desktop-side confirmation before it can continue.
          </div>
        </div>
        <div className="mobile-pill px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
          {providerLabel}
        </div>
      </div>

      {(sessionLabel || receivedAtLabel) && (
        <div className="mt-3 grid gap-2 text-xs mobile-muted-text">
          {sessionLabel && (
            <div>
              Session: <span className="font-mono text-[11px] text-foreground">{sessionLabel}</span>
            </div>
          )}
          {receivedAtLabel && <div>Raised: {receivedAtLabel}</div>}
        </div>
      )}

      {message && (
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-2xl border border-border/50 bg-muted/35 p-3 text-xs text-foreground">
          {message}
        </pre>
      )}

      <div className="mt-3 text-xs mobile-subtle-text">
        This prompt was raised by the desktop-hosted Codex runtime. Review it on the computer, then return to mobile after the desktop side continues or finishes.
      </div>
    </>
  );

  return (
    <>
      {!mobileOverlayDismissed && (
        <div className="mobile-sheet-backdrop fixed inset-0 z-[70] flex items-end justify-center p-4 sm:hidden">
          <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-border/50 bg-background/94 shadow-2xl backdrop-blur-xl">
            <div className="border-b border-border/40 bg-background/82 px-4 py-3">
              <div className="text-sm font-semibold text-foreground">Waiting for desktop approval</div>
              <div className="mt-1 text-xs mobile-subtle-text">
                Your computer is paused on a Codex confirmation. Review the request below.
              </div>
            </div>

            <div className="max-h-[65vh] overflow-auto px-4 py-4">
              {panelBody}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border/40 bg-background/78 px-4 py-3">
              <button
                type="button"
                onClick={() => setMobileOverlayDismissed(true)}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
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
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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
            className="inline-flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
          >
            Dismiss notice
          </button>
        </div>
      </div>
    </>
  );
};
