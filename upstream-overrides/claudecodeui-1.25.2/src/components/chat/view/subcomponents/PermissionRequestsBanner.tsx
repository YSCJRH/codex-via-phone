import React from 'react';
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

export default function PermissionRequestsBanner({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
}: PermissionRequestsBannerProps) {
  if (!pendingPermissionRequests.length) {
    return null;
  }

  return (
    <div className="mb-3 space-y-2">
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
        const providerLabel = request.provider ? String(request.provider).toUpperCase() : 'UNKNOWN';
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
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {request.title || 'Permission required'}
                </div>
                <div className="text-xs mobile-muted-text">
                  Tool: <span className="font-mono">{request.toolName}</span>
                </div>
                {request.message && (
                  <div className="mt-1 max-w-2xl whitespace-pre-wrap text-xs mobile-subtle-text">
                    {request.message}
                  </div>
                )}
              </div>
              <div className="space-y-1 text-right">
                <div className="mobile-pill inline-flex px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                  {providerLabel}
                </div>
                {permissionEntry && !isDesktopOnly && (
                  <div className="text-xs mobile-muted-text">
                    Allow rule: <span className="font-mono">{permissionEntry}</span>
                  </div>
                )}
              </div>
            </div>

            {rawInput && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs mobile-subtle-text hover:text-foreground">
                  View tool input
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-2xl border border-border/50 bg-muted/35 p-3 text-xs text-foreground">
                  {rawInput}
                </pre>
              </details>
            )}

            {!isDesktopOnly && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handlePermissionDecision(request.requestId, { allow: true })}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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
                  className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium transition-colors ${
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
                  className="inline-flex items-center gap-2 rounded-xl border border-red-300 px-3.5 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-900/30"
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
