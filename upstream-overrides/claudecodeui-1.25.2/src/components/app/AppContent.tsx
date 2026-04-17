import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { IS_CODEX_ONLY_HARDENED } from '../../constants/config';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import { api } from '../../utils/api';
import type { PendingPermissionRequest } from '../chat/types/types';
import MobileNav from './MobileNav';
import DesktopApprovalOverlay, { type DesktopApprovalBridgeStatus } from './DesktopApprovalOverlay';

function normalizeDesktopApprovalRequest(value: unknown): PendingPermissionRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const requestId = String(payload.requestId || payload.interactionId || '').trim();
  if (!requestId) {
    return null;
  }

  return {
    requestId,
    interactionId: requestId,
    provider: payload.provider === 'codex' ? 'codex' : 'unknown',
    kind: typeof payload.kind === 'string' ? payload.kind : 'desktop-command-approval',
    toolName: typeof payload.toolName === 'string' ? payload.toolName : 'shell_command',
    title: typeof payload.title === 'string' ? payload.title : 'Desktop approval required',
    message: typeof payload.message === 'string' ? payload.message : null,
    input: payload.input,
    context: payload.context,
    sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : null,
    resolutionMode: payload.resolutionMode === 'desktop-only' ? 'desktop-only' : 'desktop-only',
    metadata: payload.metadata && typeof payload.metadata === 'object'
      ? (payload.metadata as Record<string, unknown>)
      : null,
    receivedAt: typeof payload.receivedAt === 'string' || payload.receivedAt instanceof Date
      ? payload.receivedAt
      : new Date(),
  };
}

function sortDesktopApprovals(items: PendingPermissionRequest[]) {
  return [...items].sort((left, right) => (
    new Date(right.receivedAt || 0).getTime() - new Date(left.receivedAt || 0).getTime()
  ));
}

type DesktopApprovalAction = 'approve' | 'deny';
type DesktopApprovalActionState = {
  pending?: boolean;
  error?: string | null;
  success?: string | null;
  waitingOnDesktop?: boolean;
  requestSnapshot?: PendingPermissionRequest | null;
};

export default function AppContent() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, latestMessage, isConnected } = useWebSocket();
  const wasConnectedRef = useRef(false);
  const [desktopApprovals, setDesktopApprovals] = useState<PendingPermissionRequest[]>([]);
  const [dismissedDesktopApprovalIds, setDismissedDesktopApprovalIds] = useState<string[]>([]);
  const [desktopApprovalActionState, setDesktopApprovalActionState] = useState<Record<string, DesktopApprovalActionState>>({});
  const [desktopApprovalBridgeStatus, setDesktopApprovalBridgeStatus] = useState<DesktopApprovalBridgeStatus | null>(null);

  const {
    activeSessions,
    processingSessions,
    terminalSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
    markSessionAsTerminal,
    replaceTemporarySession,
  } = useSessionProtection();

  const {
    selectedProject,
    selectedSession,
    routeResolutionState,
    unresolvedSessionId,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    isInputFocused,
    externalMessageUpdate,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    refreshProjectsSilently,
    sidebarSharedProps,
  } = useProjectsState({
    sessionId,
    navigate,
    latestMessage,
    isMobile,
    activeSessions,
    processingSessions,
    terminalSessions,
  });
  const effectiveCurrentSessionId = selectedSession?.id || sessionId || null;

  useEffect(() => {
    // Expose a non-blocking refresh for chat/session flows.
    // Full loading refreshes are still available through direct fetchProjects calls.
    window.refreshProjects = refreshProjectsSilently;

    return () => {
      if (window.refreshProjects === refreshProjectsSilently) {
        delete window.refreshProjects;
      }
    };
  }, [refreshProjectsSilently]);

  useEffect(() => {
    window.openSettings = openSettings;

    return () => {
      if (window.openSettings === openSettings) {
        delete window.openSettings;
      }
    };
  }, [openSettings]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    sendMessage({
      type: 'get-desktop-approvals',
      provider: 'codex',
    });
  }, [isConnected, sendMessage]);

  // Permission recovery: query pending permissions on WebSocket reconnect or session change
  useEffect(() => {
    const isReconnect = isConnected && !wasConnectedRef.current;

    if (isReconnect) {
      wasConnectedRef.current = true;
    } else if (!isConnected) {
      wasConnectedRef.current = false;
    }

    if (isConnected && effectiveCurrentSessionId) {
      sendMessage({
        type: 'get-pending-permissions',
        sessionId: effectiveCurrentSessionId
      });
      sendMessage({
        type: 'get-pending-interactions',
        sessionId: effectiveCurrentSessionId
      });
    }
  }, [effectiveCurrentSessionId, isConnected, sendMessage]);

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    if (latestMessage.type !== 'desktop-approvals-response' && latestMessage.type !== 'desktop-approvals-updated') {
      return;
    }

    const normalized: PendingPermissionRequest[] = Array.isArray(latestMessage.data)
      ? latestMessage.data
          .map((item: unknown) => normalizeDesktopApprovalRequest(item))
          .filter((item: PendingPermissionRequest | null): item is PendingPermissionRequest => Boolean(item))
      : [];

    setDesktopApprovals(sortDesktopApprovals(normalized));
    setDismissedDesktopApprovalIds((previous) => {
      const activeIds = new Set(normalized.map((item) => item.requestId));
      return previous.filter((requestId) => activeIds.has(requestId));
    });
    setDesktopApprovalActionState((previous) => {
      const activeIds = new Set(normalized.map((item) => item.requestId));
      const nextState = Object.fromEntries(
        Object.entries(previous).filter(([requestId, state]) => (
          activeIds.has(requestId) || state?.pending
        )),
      );

      return Object.keys(nextState).length === Object.keys(previous).length
        ? previous
        : nextState;
    });
  }, [latestMessage]);

  const visibleDesktopApprovals = useMemo(() => {
    const dismissedIds = new Set(dismissedDesktopApprovalIds);
    return desktopApprovals.filter((request) => !dismissedIds.has(request.requestId));
  }, [desktopApprovals, dismissedDesktopApprovalIds]);

  const refreshDesktopApprovalBridgeStatus = useCallback(async () => {
    try {
      const response = await api.desktopApprovalBridgeStatus();
      const payload = await response.json();

      if (!response.ok || !payload?.success || !payload?.status) {
        throw new Error(payload?.error || payload?.message || 'Failed to load desktop approval bridge status');
      }

      setDesktopApprovalBridgeStatus(payload.status as DesktopApprovalBridgeStatus);
    } catch (error) {
      setDesktopApprovalBridgeStatus({
        enabled: false,
        active: false,
        message: error instanceof Error ? error.message : 'Failed to load desktop approval bridge status',
      });
    }
  }, []);

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    void refreshDesktopApprovalBridgeStatus();
  }, [isConnected, refreshDesktopApprovalBridgeStatus]);

  useEffect(() => {
    if (!visibleDesktopApprovals.length) {
      return;
    }

    void refreshDesktopApprovalBridgeStatus();
    const intervalId = window.setInterval(() => {
      void refreshDesktopApprovalBridgeStatus();
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [visibleDesktopApprovals.length, refreshDesktopApprovalBridgeStatus]);

  const handleDismissDesktopApproval = useCallback((requestId: string) => {
    setDismissedDesktopApprovalIds((previous) => (
      previous.includes(requestId) ? previous : [...previous, requestId]
    ));
  }, []);

  const handleDismissAllDesktopApprovals = useCallback(() => {
    setDismissedDesktopApprovalIds(desktopApprovals.map((request) => request.requestId));
  }, [desktopApprovals]);

  const handleOpenDesktopApprovalSession = useCallback((requestId: string, targetSessionId: string) => {
    navigate(`/session/${targetSessionId}`);
    sendMessage({ type: 'get-desktop-approvals', provider: 'codex' });

    void refreshProjectsSilently();
    window.setTimeout(() => {
      sendMessage({ type: 'get-desktop-approvals', provider: 'codex' });
    }, 300);
  }, [navigate, refreshProjectsSilently, sendMessage]);

  const handleResolveDesktopApproval = useCallback(async (requestId: string, action: DesktopApprovalAction) => {
    const requestSnapshot = desktopApprovals.find((request) => request.requestId === requestId)
      || visibleDesktopApprovals.find((request) => request.requestId === requestId)
      || null;

    setDesktopApprovalActionState((previous) => ({
      ...previous,
      [requestId]: {
        pending: true,
        error: null,
        success: null,
        waitingOnDesktop: false,
        requestSnapshot,
      },
    }));

    try {
      const response = await api.resolveDesktopApproval(requestId, action, effectiveCurrentSessionId || undefined);
      const payload = await response.json();
      const nextApprovals = Array.isArray(payload?.approvals)
        ? payload.approvals
            .map((item: unknown) => normalizeDesktopApprovalRequest(item))
            .filter((item: PendingPermissionRequest | null): item is PendingPermissionRequest => Boolean(item))
        : null;

      if (!response.ok || !payload?.success) {
        if (nextApprovals) {
          setDesktopApprovals(sortDesktopApprovals(nextApprovals));
        }
        throw new Error(payload?.error || payload?.message || 'Failed to resolve desktop approval');
      }

      const resolvedApprovals = nextApprovals || [];
      const bridgeStateStatus = typeof payload?.state?.status === 'string' ? payload.state.status : null;
      const isStillWaitingOnDesktop = response.status === 202 || bridgeStateStatus === 'sent';

      setDesktopApprovals(sortDesktopApprovals(resolvedApprovals));
      setDismissedDesktopApprovalIds((previous) => previous.filter((item) => item !== requestId));
      setDesktopApprovalActionState((previous) => ({
        ...previous,
        [requestId]: {
          pending: false,
          error: null,
          success: typeof payload?.message === 'string'
            ? payload.message
            : isStillWaitingOnDesktop
              ? 'Reply sent, but the desktop prompt is still waiting for acknowledgement.'
              : 'Desktop approval reply sent.',
          waitingOnDesktop: isStillWaitingOnDesktop,
          requestSnapshot: requestSnapshot || previous[requestId]?.requestSnapshot || null,
        },
      }));
      sendMessage({ type: 'get-desktop-approvals', provider: 'codex' });
    } catch (error) {
      setDesktopApprovalActionState((previous) => ({
        ...previous,
        [requestId]: {
          pending: false,
          error: error instanceof Error ? error.message : 'Failed to resolve desktop approval',
          success: null,
          waitingOnDesktop: false,
          requestSnapshot: requestSnapshot || previous[requestId]?.requestSnapshot || null,
        },
      }));
    }
  }, [desktopApprovals, effectiveCurrentSessionId, sendMessage, visibleDesktopApprovals]);

  return (
    <div className="fixed inset-0 flex bg-background">
      {!isMobile ? (
        <div className="h-full flex-shrink-0 border-r border-border/50">
          <Sidebar {...sidebarSharedProps} />
        </div>
      ) : (
        <div
          className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'
            }`}
        >
          <button
            className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(event) => {
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
          />
          <div
            className={`relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card transition-transform duration-150 ease-out sm:w-80 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          >
            <Sidebar {...sidebarSharedProps} />
          </div>
        </div>
      )}

      <div className={`flex min-w-0 flex-1 flex-col ${isMobile && !IS_CODEX_ONLY_HARDENED ? 'pb-mobile-nav' : ''}`}>
        <MainContent
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          ws={ws}
          sendMessage={sendMessage}
          latestMessage={latestMessage}
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          isLoading={isLoadingProjects}
          routeResolutionState={routeResolutionState}
          unresolvedSessionId={unresolvedSessionId}
          onInputFocusChange={setIsInputFocused}
          onSessionActive={markSessionAsActive}
          onSessionInactive={markSessionAsInactive}
          onSessionProcessing={markSessionAsProcessing}
          onSessionNotProcessing={markSessionAsNotProcessing}
          onSessionTerminal={markSessionAsTerminal}
          processingSessions={processingSessions}
          terminalSessions={terminalSessions}
          onReplaceTemporarySession={replaceTemporarySession}
          onNavigateToSession={(targetSessionId: string) => navigate(`/session/${targetSessionId}`)}
          onShowSettings={() => setShowSettings(true)}
          externalMessageUpdate={externalMessageUpdate}
        />
      </div>

      {isMobile && !IS_CODEX_ONLY_HARDENED && (
        <MobileNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isInputFocused={isInputFocused}
        />
      )}

      <DesktopApprovalOverlay
        requests={visibleDesktopApprovals}
        bridgeStatus={desktopApprovalBridgeStatus}
        currentSessionId={effectiveCurrentSessionId}
        onDismiss={handleDismissDesktopApproval}
        onDismissAll={handleDismissAllDesktopApprovals}
        onOpenSession={handleOpenDesktopApprovalSession}
        onResolve={handleResolveDesktopApproval}
        actionStateByRequestId={desktopApprovalActionState}
      />

    </div>
  );
}
