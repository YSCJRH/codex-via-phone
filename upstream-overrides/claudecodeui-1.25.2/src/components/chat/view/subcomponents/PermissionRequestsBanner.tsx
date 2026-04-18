import React from 'react';
import { AlertCircle, CheckCircle2, KeyRound, ShieldCheck, Wrench } from 'lucide-react';
import type { PendingPermissionRequest } from '../../types/types';
import { buildClaudeToolPermissionEntry, formatToolInputForDisplay } from '../../utils/chatPermissions';
import { getClaudeSettings } from '../../utils/chatStorage';
import { getPermissionPanel, registerPermissionPanel } from '../../tools/configs/permissionPanelRegistry';
import type { PermissionDecision } from '../../tools/configs/permissionPanelRegistry';
import { AskUserQuestionPanel } from '../../tools/components/InteractiveRenderers';
import { DesktopInterventionPanel } from '../../tools/components/InteractiveRenderers/DesktopInterventionPanel';

registerPermissionPanel('AskUserQuestion', AskUserQuestionPanel);
registerPermissionPanel('DesktopInterventionRequired', DesktopInterventionPanel);

interface PermissionRequestsBannerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (requestIds: string | string[], decision: PermissionDecision) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
}

function getProviderLabel(request: PendingPermissionRequest) {
  return request.provider ? String(request.provider).toUpperCase() : 'UNKNOWN';
}

export default function PermissionRequestsBanner({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
}: PermissionRequestsBannerProps) {
  if (!pendingPermissionRequests.length) {
    return null;
  }

  return (
    <div className="mb-3 space-y-2.5">
      <div className="mobile-card mobile-shadow p-4">
        <div className="flex items-start gap-3">
          <div className="mobile-pill inline-flex h-11 w-11 flex-shrink-0 items-center justify-center text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">
              {pendingPermissionRequests.length === 1
                ? '1 permission prompt is waiting'
                : `${pendingPermissionRequests.length} permission prompts are waiting`}
            </div>
            <div className="mt-1 text-xs leading-5 mobile-subtle-text">
              Review each tool request before Codex continues. Saved permissions only appear when a reusable allow rule exists.
            </div>
          </div>
        </div>
      </div>

      {pendingPermissionRequests.map((request) => {
        const CustomPanel = getPermissionPanel(request.toolName);
        if (CustomPanel) {
          return (
            <CustomPanel
              key={request.requestId}
              request={request}
              onDecision={handlePermissionDecision}
            />
          );
        }

        const rawInput = formatToolInputForDisplay(request.input);
        const isDesktopOnly = request.resolutionMode === 'desktop-only';
        const providerLabel = getProviderLabel(request);
        const permissionEntry =
          request.provider === 'claude'
            ? buildClaudeToolPermissionEntry(request.toolName, rawInput)
            : null;
        const settings = getClaudeSettings();
        const alreadyAllowed = permissionEntry ? settings.allowedTools.includes(permissionEntry) : false;
        const rememberLabel = alreadyAllowed ? 'Allow (saved)' : 'Allow & remember';
        const matchingRequestIds = permissionEntry
          ? pendingPermissionRequests
              .filter(
                (item) =>
                  buildClaudeToolPermissionEntry(item.toolName, formatToolInputForDisplay(item.input)) === permissionEntry,
              )
              .map((item) => item.requestId)
          : [request.requestId];

        return (
          <div
            key={request.requestId}
            className="mobile-card mobile-shadow p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mobile-pill inline-flex h-11 w-11 flex-shrink-0 items-center justify-center text-primary">
                  <Wrench className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="mobile-clamp-2 text-sm font-semibold text-foreground">
                    {request.title || 'Permission required'}
                  </div>
                  <div className="mt-1 text-xs leading-5 mobile-subtle-text">
                    {request.message || 'Codex is asking for permission before it continues with this tool step.'}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <div className="mobile-pill inline-flex px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-primary">
                  {providerLabel}
                </div>
                <div className="mobile-pill inline-flex px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-foreground">
                  {request.toolName}
                </div>
                <div className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide ${
                  isDesktopOnly
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
                    : permissionEntry
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : 'bg-slate-100 text-slate-700 dark:bg-slate-900/60 dark:text-slate-200'
                }`}>
                  {isDesktopOnly ? 'Desktop only' : permissionEntry ? 'Rule available' : 'One-time only'}
                </div>
              </div>
            </div>

            {!isDesktopOnly ? (
              <div className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${
                permissionEntry
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
                  : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
              }`}>
                <div className="flex items-start gap-2">
                  {permissionEntry ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium">
                      {permissionEntry
                        ? (alreadyAllowed ? 'A saved allow rule already exists for this tool pattern.' : 'This request can be approved once or saved as a reusable allow rule.')
                        : 'This request can only be approved once because it does not expose a reusable allow rule.'}
                    </div>
                    {permissionEntry ? (
                      <div className="mt-1 break-all font-mono text-[11px]">
                        {permissionEntry}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                This request is mirrored on mobile for visibility, but it still needs to be completed on the desktop side.
              </div>
            )}

            {rawInput && (
              <details className="mt-3 rounded-2xl border border-border/45 bg-background/45 px-3 py-3">
                <summary className="cursor-pointer list-none text-xs font-medium text-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>View tool input</span>
                    <span className="mobile-pill inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-foreground">
                      <KeyRound className="h-3 w-3 text-primary" />
                      details
                    </span>
                  </div>
                </summary>
                <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-2xl border border-border/50 bg-muted/35 p-3 text-xs leading-5 text-foreground">
                  {rawInput}
                </pre>
              </details>
            )}

            {!isDesktopOnly && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handlePermissionDecision(request.requestId, { allow: true })}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Allow once
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (permissionEntry && !alreadyAllowed) {
                      handleGrantToolPermission({ entry: permissionEntry, toolName: request.toolName });
                    }
                    handlePermissionDecision(matchingRequestIds, { allow: true, rememberEntry: permissionEntry });
                  }}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-medium transition-colors ${
                    permissionEntry
                      ? 'border-border/60 text-foreground hover:bg-muted/50'
                      : 'cursor-not-allowed border-gray-300 text-gray-400'
                  }`}
                  disabled={!permissionEntry}
                >
                  {rememberLabel}
                </button>
                <button
                  type="button"
                  onClick={() => handlePermissionDecision(request.requestId, { allow: false, message: 'User denied tool use' })}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-300 px-3.5 py-2.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-900/30"
                >
                  Deny
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
