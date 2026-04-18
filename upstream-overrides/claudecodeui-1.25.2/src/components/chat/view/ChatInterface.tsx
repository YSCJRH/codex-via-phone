import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, RefreshCcw } from 'lucide-react';
import { IS_CODEX_ONLY_HARDENED } from '../../../constants/config';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { QuickSettingsPanel } from '../../quick-settings-panel';
import type { ChatInterfaceProps, Provider  } from '../types/types';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import ChatInputControls from './subcomponents/ChatInputControls';
import MobileBottomSheet from '../../app/MobileBottomSheet';


type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

function ChatInterface({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  latestMessage,
  onFileOpen,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  onSessionTerminal,
  processingSessions,
  terminalSessions,
  onReplaceTemporarySession,
  onNavigateToSession,
  onShowSettings,
  autoExpandTools,
  showRawParameters,
  showThinking,
  autoScrollToBottom,
  sendByCtrlEnter,
  externalMessageUpdate,
  onShowAllTasks,
  isMobile = false,
  mobileSheet = 'none',
  onMobileSheetChange,
}: ChatInterfaceProps) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { t } = useTranslation('chat');

  const streamBufferRef = useRef('');
  const streamTimerRef = useRef<number | null>(null);
  const pendingViewSessionRef = useRef<PendingViewSession | null>(null);
  const reconnectCatchupTimerRef = useRef<number | null>(null);
  const externalSyncNoticeTimerRef = useRef<number | null>(null);
  const lastExternalMessageUpdateRef = useRef(externalMessageUpdate ?? 0);
  const [showExternalSyncNotice, setShowExternalSyncNotice] = useState(false);
  const codexInputBlockedReason = useMemo(() => {
    if (selectedSession?.__provider !== 'codex' || selectedSession.resumeSupported !== false) {
      return null;
    }

    if (selectedSession.threadHealth === 'recovered') {
      return 'This is a recovered Codex thread. Sending from mobile would start a different thread instead of syncing back to the original desktop thread.';
    }

    return 'This Codex thread cannot be resumed safely right now.';
  }, [selectedSession]);

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamBufferRef.current = '';
  }, []);

  const {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    geminiModel,
    setGeminiModel,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  } = useChatProviderState({
    selectedSession,
  });

  const {
    chatMessages,
    setChatMessages,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    sessionMessages,
    setSessionMessages,
    applySessionMessages,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    setIsSystemSessionChange,
    canAbortSession,
    setCanAbortSession,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    claudeStatus,
    setClaudeStatus,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
    loadSessionMessages,
    loadCursorSessionMessages,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    autoScrollToBottom,
    externalMessageUpdate,
    processingSessions,
    terminalSessions,
    resetStreamingState,
    pendingViewSessionRef,
  });

  const {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    thinkingMode,
    setThinkingMode,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedImages,
    setAttachedImages,
    uploadingImages,
    imageErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openImagePicker,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handleTranscript,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    currentSessionId,
    ws,
    provider,
    permissionMode,
    cyclePermissionMode,
    cursorModel,
    claudeModel,
    codexModel,
    geminiModel,
    isLoading,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    onSessionActive,
    onSessionProcessing,
    onInputFocusChange,
    onFileOpen,
    onShowSettings,
    pendingViewSessionRef,
    scrollToBottom,
    setChatMessages,
    setSessionMessages,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setIsUserScrolledUp,
    setPendingPermissionRequests,
  });

  // On WebSocket reconnect, re-fetch the current session's messages from JSONL so missed
  // streaming events (e.g. from long tool calls while iOS had the tab backgrounded) are shown.
  // Also reset isLoading - if the server restarted or the session died mid-stream, the client
  // would be stuck in "Processing..." forever without this reset.
  const reloadCurrentSessionMessages = useCallback(async (refreshStatusOrSessionId: boolean | string | null = false) => {
    if (!selectedProject || !selectedSession) return;
    const refreshStatus = refreshStatusOrSessionId === true;
    const activeProvider = selectedSession.__provider || (IS_CODEX_ONLY_HARDENED ? 'codex' : 'claude');
    if (activeProvider === 'cursor') {
      const projectPath = selectedProject.fullPath || selectedProject.path || '';
      const messages = await loadCursorSessionMessages(projectPath, selectedSession.id);
      setSessionMessages([]);
      setChatMessages(messages);
    } else {
      const messages = await loadSessionMessages(selectedProject.name, selectedSession.id, false, activeProvider);
      applySessionMessages(messages, { forceChatSync: refreshStatus });
    }
    if (refreshStatus) {
      sendMessage({
        type: 'check-session-status',
        sessionId: selectedSession.id,
        provider: activeProvider,
      });
      sendMessage({
        type: 'get-pending-interactions',
        sessionId: selectedSession.id,
        provider: activeProvider,
      });
    }
  }, [
    applySessionMessages,
    selectedProject,
    selectedSession,
    loadCursorSessionMessages,
    loadSessionMessages,
    sendMessage,
    setChatMessages,
    setSessionMessages,
  ]);

  const handleWebSocketReconnect = useCallback(async () => {
    if (reconnectCatchupTimerRef.current) {
      clearTimeout(reconnectCatchupTimerRef.current);
      reconnectCatchupTimerRef.current = null;
    }

    await reloadCurrentSessionMessages(true);

    reconnectCatchupTimerRef.current = window.setTimeout(() => {
      void reloadCurrentSessionMessages(true);
      reconnectCatchupTimerRef.current = null;
    }, 1500);
    // Reset loading state - if the session is still active, new WebSocket messages will
    // set it back to true. If it died, this clears the permanent frozen state.
    setIsLoading(false);
    setCanAbortSession(false);
  }, [
    reloadCurrentSessionMessages,
    setCanAbortSession,
    setIsLoading,
  ]);

  useChatRealtimeHandlers({
    latestMessage,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setChatMessages,
    isLoading,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setTokenBudget,
    setIsSystemSessionChange,
    setPendingPermissionRequests,
    pendingViewSessionRef,
    streamBufferRef,
    streamTimerRef,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onSessionTerminal,
    terminalSessions,
    onReplaceTemporarySession,
    onNavigateToSession,
    onCatchUpSessionMessages: reloadCurrentSessionMessages,
    onWebSocketReconnect: handleWebSocketReconnect,
  });

  useEffect(() => {
    if (!isLoading || !canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession, isLoading]);

  useEffect(() => {
    if (!isLoading) {
      return;
    }

    const activeSessionId =
      currentSessionId ||
      selectedSession?.id ||
      pendingViewSessionRef.current?.sessionId ||
      (typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null);

    if (!activeSessionId) {
      return;
    }

    const activeProvider = selectedSession?.__provider || (IS_CODEX_ONLY_HARDENED ? 'codex' : 'claude');
    const intervalId = window.setInterval(() => {
      sendMessage({
        type: 'check-session-status',
        sessionId: activeSessionId,
        provider: activeProvider,
      });
      sendMessage({
        type: 'get-pending-interactions',
        sessionId: activeSessionId,
        provider: activeProvider,
      });
    }, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [
    currentSessionId,
    isLoading,
    selectedSession,
    sendMessage,
  ]);

  useEffect(() => {
    if (!selectedSession?.id) {
      setShowExternalSyncNotice(false);
      lastExternalMessageUpdateRef.current = externalMessageUpdate ?? 0;
      return;
    }

    const nextExternalUpdate = externalMessageUpdate ?? 0;
    if (nextExternalUpdate <= lastExternalMessageUpdateRef.current) {
      return;
    }

    lastExternalMessageUpdateRef.current = nextExternalUpdate;
    setShowExternalSyncNotice(true);

    if (externalSyncNoticeTimerRef.current) {
      clearTimeout(externalSyncNoticeTimerRef.current);
    }

    externalSyncNoticeTimerRef.current = window.setTimeout(() => {
      setShowExternalSyncNotice(false);
      externalSyncNoticeTimerRef.current = null;
    }, 8000);
  }, [externalMessageUpdate, selectedSession?.id]);

  useEffect(() => {
    return () => {
      resetStreamingState();
      if (reconnectCatchupTimerRef.current) {
        clearTimeout(reconnectCatchupTimerRef.current);
        reconnectCatchupTimerRef.current = null;
      }
      if (externalSyncNoticeTimerRef.current) {
        clearTimeout(externalSyncNoticeTimerRef.current);
        externalSyncNoticeTimerRef.current = null;
      }
    };
  }, [resetStreamingState]);

  if (!selectedProject) {
    const selectedProviderLabel = IS_CODEX_ONLY_HARDENED ? t('messageTypes.codex') : (
      provider === 'cursor'
        ? t('messageTypes.cursor')
        : provider === 'codex'
          ? t('messageTypes.codex')
          : provider === 'gemini'
            ? t('messageTypes.gemini')
            : t('messageTypes.claude')
    );

    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: selectedProviderLabel,
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`flex h-full flex-col ${isMobile ? 'mobile-shell' : ''}`}>
        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          onWheel={handleScroll}
          onTouchMove={handleScroll}
          isLoadingSessionMessages={isLoadingSessionMessages}
          chatMessages={chatMessages}
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={(nextProvider) => setProvider(nextProvider as Provider)}
          textareaRef={textareaRef}
          claudeModel={claudeModel}
          setClaudeModel={setClaudeModel}
          cursorModel={cursorModel}
          setCursorModel={setCursorModel}
          codexModel={codexModel}
          setCodexModel={setCodexModel}
          geminiModel={geminiModel}
          setGeminiModel={setGeminiModel}
          tasksEnabled={tasksEnabled}
          isTaskMasterInstalled={isTaskMasterInstalled}
          onShowAllTasks={onShowAllTasks}
          setInput={setInput}
          isLoadingMoreMessages={isLoadingMoreMessages}
          hasMoreMessages={hasMoreMessages}
          totalMessages={totalMessages}
          sessionMessagesCount={sessionMessages.length}
          visibleMessageCount={visibleMessageCount}
          visibleMessages={visibleMessages}
          loadEarlierMessages={loadEarlierMessages}
          loadAllMessages={loadAllMessages}
          allMessagesLoaded={allMessagesLoaded}
          isLoadingAllMessages={isLoadingAllMessages}
          loadAllJustFinished={loadAllJustFinished}
          showLoadAllOverlay={showLoadAllOverlay}
          createDiff={createDiff}
          onFileOpen={onFileOpen}
          onShowSettings={onShowSettings}
          onGrantToolPermission={handleGrantToolPermission}
          autoExpandTools={autoExpandTools}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
          isLoading={isLoading}
        />

        {showExternalSyncNotice && (
          <div className="px-3 pb-2 sm:px-4">
            <div className="mx-auto max-w-4xl">
              <div className="mobile-card mobile-shadow border-emerald-200/80 bg-emerald-50/88 px-4 py-3 backdrop-blur-sm dark:border-emerald-900/60 dark:bg-emerald-950/28">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/45 dark:text-emerald-200">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">
                          {t('sync.externalUpdate.title', {
                            defaultValue: 'This thread was updated from another device',
                          })}
                        </p>
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/45 dark:text-emerald-200">
                          Synced
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {t('sync.externalUpdate.body', {
                          defaultValue: 'The desktop view has been synced to the latest turn, so you can continue from the newest message.',
                        })}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-background px-3 py-2 text-sm font-medium text-foreground transition hover:bg-emerald-100 dark:border-emerald-800 dark:hover:bg-emerald-900/40"
                    onClick={() => {
                      scrollToBottomAndReset();
                      setShowExternalSyncNotice(false);
                    }}
                  >
                    <RefreshCcw className="h-4 w-4" />
                    {t('sync.externalUpdate.action', {
                      defaultValue: 'Go to latest',
                    })}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <ChatComposer
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          claudeStatus={claudeStatus}
          isLoading={isLoading}
          onAbortSession={handleAbortSession}
          provider={provider}
          permissionMode={permissionMode}
          onModeSwitch={cyclePermissionMode}
          thinkingMode={thinkingMode}
          setThinkingMode={setThinkingMode}
          tokenBudget={tokenBudget}
          slashCommandsCount={slashCommandsCount}
          onToggleCommandMenu={handleToggleCommandMenu}
          hasInput={Boolean(input.trim())}
          onClearInput={handleClearInput}
          isUserScrolledUp={isUserScrolledUp}
          hasMessages={chatMessages.length > 0}
          onScrollToBottom={scrollToBottomAndReset}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          attachedImages={attachedImages}
          onRemoveImage={(index) =>
            setAttachedImages((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          uploadingImages={uploadingImages}
          imageErrors={imageErrors}
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={selectFile}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          onCommandSelect={handleCommandSelect}
          onCloseCommandMenu={resetCommandMenuState}
          isCommandMenuOpen={showCommandMenu}
          frequentCommands={commandQuery ? [] : frequentCommands}
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openImagePicker={openImagePicker}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          onInputChange={handleInputChange}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={handleKeyDown}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          onInputFocusChange={handleInputFocusChange}
          isInputFocused={isInputFocused}
          placeholder={t('input.placeholder', {
            provider:
              provider === 'cursor'
                ? t('messageTypes.cursor')
                : provider === 'codex'
                  ? t('messageTypes.codex')
                  : provider === 'gemini'
                    ? t('messageTypes.gemini')
                    : t('messageTypes.claude'),
          })}
          inputBlockedReason={codexInputBlockedReason}
          isTextareaExpanded={isTextareaExpanded}
          sendByCtrlEnter={sendByCtrlEnter}
          onTranscript={handleTranscript}
          isMobile={isMobile}
          onOpenComposerSettings={() => onMobileSheetChange?.('composer-settings')}
        />
      </div>

      {isMobile && (
        <MobileBottomSheet
          open={mobileSheet === 'composer-settings'}
          onClose={() => onMobileSheetChange?.('none')}
          title="Session settings"
          description="Move model, reasoning, permission, and context controls into a secondary sheet so the main composer stays clean."
        >
          <div className="space-y-4">
            <div className="mobile-card p-4">
              <div className="text-[13px] font-medium uppercase tracking-[0.12em] mobile-muted-text">
                Current thread
              </div>
              <div className="mt-2 text-[16px] font-semibold text-foreground">
                {selectedSession?.summary || selectedSession?.name || selectedProject?.displayName || selectedProject?.name || 'Chat'}
              </div>
              <div className="mt-1 text-[13px] mobile-muted-text">
                {`Provider ${String(provider).toUpperCase()} / Session ${currentSessionId || selectedSession?.id || 'pending'}`}
              </div>
            </div>

            <div className="mobile-card p-4">
              <ChatInputControls
                permissionMode={permissionMode}
                onModeSwitch={cyclePermissionMode}
                provider={provider}
                thinkingMode={thinkingMode}
                setThinkingMode={setThinkingMode}
                tokenBudget={tokenBudget}
                slashCommandsCount={slashCommandsCount}
                onToggleCommandMenu={handleToggleCommandMenu}
                hasInput={Boolean(input.trim())}
                onClearInput={handleClearInput}
                isUserScrolledUp={isUserScrolledUp}
                hasMessages={chatMessages.length > 0}
                onScrollToBottom={scrollToBottomAndReset}
                variant="sheet"
              />
            </div>
          </div>
        </MobileBottomSheet>
      )}

      {!IS_CODEX_ONLY_HARDENED && <QuickSettingsPanel />}
    </>
  );
}

export default React.memo(ChatInterface);
