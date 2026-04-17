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
          <div className="text-sm font-semibold text-blue-900 dark:text-blue-100">{title}</div>
          <div className="mt-1 text-xs text-blue-800 dark:text-blue-200">
            This session needs a desktop-side confirmation before it can continue.
          </div>
        </div>
        <div className="rounded-full border border-blue-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700 dark:border-blue-700 dark:text-blue-200">
          {providerLabel}
        </div>
      </div>

      {(sessionLabel || receivedAtLabel) && (
        <div className="mt-3 grid gap-2 text-xs text-blue-800 dark:text-blue-200">
          {sessionLabel && (
            <div>
              Session: <span className="font-mono text-[11px]">{sessionLabel}</span>
            </div>
          )}
          {receivedAtLabel && <div>Raised: {receivedAtLabel}</div>}
        </div>
      )}

      {message && (
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-blue-200/70 bg-white/90 p-2 text-xs text-blue-900 dark:border-blue-800/60 dark:bg-slate-950/40 dark:text-blue-100">
          {message}
        </pre>
      )}

      <div className="mt-3 text-xs text-blue-800 dark:text-blue-200">
        This prompt was raised by the desktop-hosted Codex runtime. Review it on the computer, then return to mobile after the desktop side continues or finishes.
      </div>
    </>
  );

  return (
    <>
      {!mobileOverlayDismissed && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 p-4 sm:hidden">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-2xl">
            <div className="border-b border-blue-100 bg-blue-50 px-4 py-3">
              <div className="text-sm font-semibold text-blue-950">Waiting for desktop approval</div>
              <div className="mt-1 text-xs text-blue-800">
                Your computer is paused on a Codex confirmation. Review the request below.
              </div>
            </div>

            <div className="max-h-[65vh] overflow-auto px-4 py-4">
              {panelBody}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-blue-100 bg-slate-50 px-4 py-3">
              <button
                type="button"
                onClick={() => setMobileOverlayDismissed(true)}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-blue-300 px-3 py-2 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-50"
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
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700"
              >
                Dismiss reminder
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="hidden rounded-lg border border-blue-200 bg-blue-50 p-3 shadow-sm dark:border-blue-800 dark:bg-blue-950/30 sm:block">
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
            className="inline-flex items-center gap-2 rounded-md border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-100 dark:border-blue-700 dark:text-blue-100 dark:hover:bg-blue-900/30"
          >
            Dismiss notice
          </button>
        </div>
      </div>
    </>
  );
};
