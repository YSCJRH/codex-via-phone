import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { IS_CODEX_ONLY_HARDENED } from '../../constants/config';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import { api } from '../../utils/api';
import type { PendingPermissionRequest } from '../chat/types/types';
import type { AppTab, Project, ProjectSession } from '../../types/app';
import MobileNav from './MobileNav';
import DesktopApprovalOverlay, { type DesktopApprovalBridgeStatus } from './DesktopApprovalOverlay';
import MobileHomeScreen from './MobileHomeScreen';
import MobileMoreSheet from './MobileMoreSheet';
import MobileSearchSheet from './MobileSearchSheet';

type MobileSheetState = 'none' | 'more' | 'search' | 'composer-settings';

const LAST_MOBILE_SESSION_STORAGE_KEY = 'mobile-codex:last-session-id';

function readLastMobileSessionId() {
  try {
    return localStorage.getItem(LAST_MOBILE_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLastMobileSessionId(sessionId: string | null) {
  try {
    if (!sessionId) {
      localStorage.removeItem(LAST_MOBILE_SESSION_STORAGE_KEY);
      return;
    }

    localStorage.setItem(LAST_MOBILE_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Ignore storage failures so the mobile UI remains functional.
  }
}

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
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, latestMessage, isConnected } = useWebSocket();
  const wasConnectedRef = useRef(false);
  const [mobileSheet, setMobileSheet] = useState<MobileSheetState>('none');
  const [lastMobileSessionId, setLastMobileSessionId] = useState<string | null>(() => readLastMobileSessionId());
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
    isLoadingProjects,
    isInputFocused,
    externalMessageUpdate,
    setActiveTab,
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
  const mobileProjects = sidebarSharedProps.projects || [];

  useEffect(() => {
    if (!isMobile || !selectedSession?.id) {
      return;
    }

    setLastMobileSessionId(selectedSession.id);
    writeLastMobileSessionId(selectedSession.id);
  }, [isMobile, selectedSession?.id]);

  useEffect(() => {
    if (!isMobile) {
      return;
    }

    if (sessionId || activeTab !== 'chat') {
      setMobileSheet('none');
    }
  }, [activeTab, isMobile, sessionId]);

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

  const resolveMobileFallbackSessionId = useMemo(() => {
    if (lastMobileSessionId) {
      return lastMobileSessionId;
    }

    for (const project of mobileProjects) {
      const allSessions = [
        ...(project.codexSessions || []),
        ...(project.sessions || []),
        ...(project.cursorSessions || []),
        ...(project.geminiSessions || []),
      ];
      if (allSessions[0]?.id) {
        return allSessions[0].id;
      }
    }

    return null;
  }, [lastMobileSessionId, mobileProjects]);

  const handleMobileHomeProjectSelect = useCallback((project: Project) => {
    setActiveTab('chat');
    setMobileSheet('none');
    sidebarSharedProps.onProjectSelect(project);
  }, [setActiveTab, sidebarSharedProps]);

  const handleMobileHomeSessionSelect = useCallback((session: ProjectSession) => {
    setActiveTab('chat');
    setMobileSheet('none');
    sidebarSharedProps.onSessionSelect(session);
  }, [setActiveTab, sidebarSharedProps]);

  const handleMobileNewSession = useCallback((project: Project) => {
    setActiveTab('chat');
    setMobileSheet('none');
    sidebarSharedProps.onNewSession(project);
  }, [setActiveTab, sidebarSharedProps]);

  const handleOpenMobileSearch = useCallback(() => {
    setMobileSheet('search');
  }, []);

  const handleOpenMobileMore = useCallback(() => {
    setMobileSheet((previous) => (previous === 'more' ? 'none' : 'more'));
  }, []);

  const handleCloseMobileSheet = useCallback(() => {
    setMobileSheet('none');
  }, []);

  const handleOpenTasks = useCallback(() => {
    setActiveTab('tasks');
    setMobileSheet('none');
    navigate('/');
  }, [navigate, setActiveTab]);

  const handleMobileProjectsClick = useCallback(() => {
    setActiveTab('chat');
    setMobileSheet('none');
    navigate('/');
  }, [navigate, setActiveTab]);

  const handleMobileChatClick = useCallback(() => {
    setActiveTab('chat');
    setMobileSheet('none');

    const targetSessionId = selectedSession?.id || effectiveCurrentSessionId || resolveMobileFallbackSessionId;
    if (targetSessionId) {
      navigate(`/session/${targetSessionId}`);
      return;
    }

    navigate('/');
  }, [effectiveCurrentSessionId, navigate, resolveMobileFallbackSessionId, selectedSession?.id, setActiveTab]);

  const handleMobileMoreSelect = useCallback((nextTab: AppTab) => {
    setActiveTab(nextTab);
    setMobileSheet('none');
    navigate('/');
  }, [navigate, setActiveTab]);

  const mobileNavActiveItem = useMemo<'projects' | 'chat' | 'more'>(() => {
    if (sessionId) {
      return 'chat';
    }

    if (mobileSheet === 'more' || activeTab !== 'chat') {
      return 'more';
    }

    return 'projects';
  }, [activeTab, mobileSheet, sessionId]);

  const shouldShowMobileHome = Boolean(isMobile && !sessionId && activeTab === 'chat' && !isLoadingProjects);

  return (
    <div className={`fixed inset-0 flex ${isMobile ? 'mobile-shell bg-background' : 'bg-background'}`}>
      {!isMobile ? (
        <div className="h-full flex-shrink-0 border-r border-border/50">
          <Sidebar {...sidebarSharedProps} />
        </div>
      ) : null}

      <div className={`flex min-w-0 flex-1 flex-col ${isMobile && !IS_CODEX_ONLY_HARDENED ? 'pb-mobile-nav' : ''}`}>
        {shouldShowMobileHome ? (
          <MobileHomeScreen
            projects={mobileProjects}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            onProjectSelect={handleMobileHomeProjectSelect}
            onSessionSelect={handleMobileHomeSessionSelect}
            onNewSession={handleMobileNewSession}
            onShowSettings={() => setShowSettings(true)}
            onOpenSearch={handleOpenMobileSearch}
            onOpenMore={handleOpenMobileMore}
            onOpenTasks={handleOpenTasks}
            desktopApprovalBridgeStatus={desktopApprovalBridgeStatus}
            desktopApprovalCount={visibleDesktopApprovals.length}
            isConnected={isConnected}
          />
        ) : (
          <MainContent
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            ws={ws}
            sendMessage={sendMessage}
            latestMessage={latestMessage}
            isMobile={isMobile}
            onMenuClick={handleMobileProjectsClick}
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
            mobileSheet={mobileSheet}
            onMobileSheetChange={setMobileSheet}
          />
        )}
      </div>

      {isMobile && !IS_CODEX_ONLY_HARDENED && (
        <MobileNav
          activeItem={mobileNavActiveItem}
          onProjectsClick={handleMobileProjectsClick}
          onChatClick={handleMobileChatClick}
          onMoreClick={handleOpenMobileMore}
          isInputFocused={isInputFocused}
        />
      )}

      {isMobile && !IS_CODEX_ONLY_HARDENED && (
        <>
          <MobileSearchSheet
            open={mobileSheet === 'search'}
            projects={mobileProjects}
            onClose={handleCloseMobileSheet}
            onProjectSelect={handleMobileHomeProjectSelect}
            onSessionSelect={handleMobileHomeSessionSelect}
          />

          <MobileMoreSheet
            open={mobileSheet === 'more'}
            activeTab={activeTab}
            selectedProject={selectedProject}
            onClose={handleCloseMobileSheet}
            onSelectTab={handleMobileMoreSelect}
            onShowSettings={() => setShowSettings(true)}
            onGoHome={handleMobileProjectsClick}
          />
        </>
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
