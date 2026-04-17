import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { api } from '../utils/api';
import {
  recordSessionSyncEvent,
  updateSessionSyncSnapshot,
} from '../utils/debugDiagnostics';
import { readProjectsBootstrapCache, writeProjectsBootstrapCache } from '../utils/projectBootstrapCache';
import { IS_CODEX_ONLY_HARDENED } from '../constants/config';
import type {
  AppSocketMessage,
  AppTab,
  LoadingProgress,
  Project,
  ProjectSession,
  ProjectsUpdatedMessage,
} from '../types/app';

type UseProjectsStateArgs = {
  sessionId?: string;
  navigate: NavigateFunction;
  latestMessage: AppSocketMessage | null;
  isMobile: boolean;
  activeSessions: Set<string>;
  processingSessions: Set<string>;
  terminalSessions: Set<string>;
};

type FetchProjectsOptions = {
  showLoadingState?: boolean;
};

type RouteResolutionState = 'ready' | 'resolving' | 'not_found';
const PROJECTS_REQUEST_TIMEOUT_MS = 15000;

const serialize = (value: unknown) => JSON.stringify(value ?? null);

const extractSessionIdFromJsonlFilename = (filename: string): string | null => {
  if (!filename.endsWith('.jsonl')) {
    return null;
  }

  const basename = filename.slice(0, -'.jsonl'.length);
  const trailingUuidMatch = basename.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (trailingUuidMatch) {
    return trailingUuidMatch[1];
  }

  return basename || null;
};

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
  includeExternalSessions: boolean,
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    const baseChanged =
      nextProject.name !== prevProject.name ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions) ||
      serialize(nextProject.taskmaster) !== serialize(prevProject.taskmaster);

    if (baseChanged) {
      return true;
    }

    if (!includeExternalSessions) {
      return false;
    }

    return (
      serialize(nextProject.cursorSessions) !== serialize(prevProject.cursorSessions) ||
      serialize(nextProject.codexSessions) !== serialize(prevProject.codexSessions) ||
      serialize(nextProject.geminiSessions) !== serialize(prevProject.geminiSessions)
    );
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  if (IS_CODEX_ONLY_HARDENED) {
    return [...(project.codexSessions ?? [])];
  }

  return [
    ...(project.sessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.cursorSessions ?? []),
    ...(project.geminiSessions ?? []),
  ];
};

type ResolvedSessionTarget = {
  project: Project;
  session: ProjectSession;
};

type ResolvedCodexSessionPayload = {
  success?: boolean;
  project?: Project | null;
  session?: ProjectSession | null;
};

const normalizeSessionProvider = (
  session: ProjectSession,
  provider: ProjectSession['__provider'],
): ProjectSession => (
  session.__provider === provider ? session : { ...session, __provider: provider }
);

const resolveSessionTarget = (
  projectList: Project[],
  targetSessionId: string,
): ResolvedSessionTarget | null => {
  for (const project of projectList) {
    const codexSession = project.codexSessions?.find((session) => session.id === targetSessionId);
    if (codexSession) {
      return {
        project,
        session: normalizeSessionProvider(codexSession, 'codex'),
      };
    }

    if (!IS_CODEX_ONLY_HARDENED) {
      const claudeSession = project.sessions?.find((session) => session.id === targetSessionId);
      if (claudeSession) {
        return {
          project,
          session: normalizeSessionProvider(claudeSession, 'claude'),
        };
      }

      const cursorSession = project.cursorSessions?.find((session) => session.id === targetSessionId);
      if (cursorSession) {
        return {
          project,
          session: normalizeSessionProvider(cursorSession, 'cursor'),
        };
      }

      const geminiSession = project.geminiSessions?.find((session) => session.id === targetSessionId);
      if (geminiSession) {
        return {
          project,
          session: normalizeSessionProvider(geminiSession, 'gemini'),
        };
      }
    }
  }

  return null;
};

const dedupeProjectSessions = (sessions: ProjectSession[]): ProjectSession[] => {
  const seenSessionIds = new Set<string>();
  const dedupedSessions: ProjectSession[] = [];

  for (const session of sessions) {
    if (!session?.id || seenSessionIds.has(session.id)) {
      continue;
    }

    seenSessionIds.add(session.id);
    dedupedSessions.push(session);
  }

  return dedupedSessions;
};

const mergeResolvedCodexProject = (
  projectList: Project[],
  resolvedProject: Project,
): { projects: Project[]; project: Project } => {
  const resolvedCodexSessions = dedupeProjectSessions(resolvedProject.codexSessions ?? []);
  const existingProjectIndex = projectList.findIndex((project) => project.name === resolvedProject.name);

  if (existingProjectIndex === -1) {
    const project: Project = {
      ...resolvedProject,
      codexSessions: resolvedCodexSessions,
      sessionMeta: {
        ...(resolvedProject.sessionMeta ?? {}),
        total: Math.max(Number(resolvedProject.sessionMeta?.total) || 0, resolvedCodexSessions.length),
      },
    };

    return {
      projects: [...projectList, project],
      project,
    };
  }

  const existingProject = projectList[existingProjectIndex];
  const mergedCodexSessions = dedupeProjectSessions([
    ...resolvedCodexSessions,
    ...(existingProject.codexSessions ?? []),
  ]);
  const mergedProject: Project = {
    ...existingProject,
    ...resolvedProject,
    sessions: resolvedProject.sessions ?? existingProject.sessions ?? [],
    cursorSessions: resolvedProject.cursorSessions ?? existingProject.cursorSessions ?? [],
    geminiSessions: resolvedProject.geminiSessions ?? existingProject.geminiSessions ?? [],
    codexSessions: mergedCodexSessions,
    sessionMeta: {
      ...(existingProject.sessionMeta ?? {}),
      ...(resolvedProject.sessionMeta ?? {}),
      total: Math.max(
        Number(existingProject.sessionMeta?.total) || 0,
        Number(resolvedProject.sessionMeta?.total) || 0,
        mergedCodexSessions.length,
      ),
    },
  };

  const nextProjects = [...projectList];
  nextProjects[existingProjectIndex] = mergedProject;
  return {
    projects: nextProjects,
    project: mergedProject,
  };
};

const isUpdateAdditive = (
  currentProjects: Project[],
  updatedProjects: Project[],
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): boolean => {
  if (!selectedProject || !selectedSession) {
    return true;
  }

  const currentSelectedProject = currentProjects.find((project) => project.name === selectedProject.name);
  const updatedSelectedProject = updatedProjects.find((project) => project.name === selectedProject.name);

  if (!currentSelectedProject || !updatedSelectedProject) {
    return false;
  }

  const currentSelectedSession = getProjectSessions(currentSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );
  const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );

  if (!currentSelectedSession || !updatedSelectedSession) {
    return false;
  }

  return (
    currentSelectedSession.id === updatedSelectedSession.id &&
    currentSelectedSession.title === updatedSelectedSession.title &&
    currentSelectedSession.created_at === updatedSelectedSession.created_at &&
    currentSelectedSession.updated_at === updatedSelectedSession.updated_at
  );
};

const VALID_TABS: Set<string> = IS_CODEX_ONLY_HARDENED
  ? new Set(['chat'])
  : new Set(['chat', 'files', 'shell', 'git', 'tasks', 'preview']);

const isValidTab = (tab: string): tab is AppTab => {
  return VALID_TABS.has(tab) || tab.startsWith('plugin:');
};

const readPersistedTab = (): AppTab => {
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored && isValidTab(stored)) {
      return stored as AppTab;
    }
  } catch {
    // localStorage unavailable
  }
  return 'chat';
};

export function useProjectsState({
  sessionId,
  navigate,
  latestMessage,
  isMobile,
  activeSessions,
  processingSessions,
  terminalSessions,
}: UseProjectsStateArgs) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [routeResolutionState, setRouteResolutionState] = useState<RouteResolutionState>(
    sessionId ? 'resolving' : 'ready',
  );
  const [unresolvedSessionId, setUnresolvedSessionId] = useState<string | null>(sessionId ?? null);
  const [activeTab, setActiveTab] = useState<AppTab>(readPersistedTab);

  useEffect(() => {
    try {
      localStorage.setItem('activeTab', activeTab);
    } catch {
      // Silently ignore storage errors
    }
  }, [activeTab]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('agents');
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasHydratedProjectsCacheRef = useRef(false);
  const projectsRef = useRef<Project[]>([]);
  const lastRouteResolutionStateRef = useRef<RouteResolutionState | null>(null);
  const codexRouteLookupSeqRef = useRef(0);
  const codexRouteLookupInFlightRef = useRef<string | null>(null);
  const failedCodexRouteLookupRef = useRef<string | null>(null);
  const hardenedProjectsRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyProjects = useCallback((projectData: Project[]) => {
    setProjects((prevProjects) => {
      if (prevProjects.length === 0) {
        return projectData;
      }

      return projectsHaveChanges(prevProjects, projectData, !IS_CODEX_ONLY_HARDENED)
        ? projectData
        : prevProjects;
    });

    writeProjectsBootstrapCache(projectData);
  }, []);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const resolveCodexSessionFromServer = useCallback(async (targetSessionId: string) => {
    if (!IS_CODEX_ONLY_HARDENED || !targetSessionId) {
      return null;
    }

    const requestId = ++codexRouteLookupSeqRef.current;
    codexRouteLookupInFlightRef.current = targetSessionId;
    recordSessionSyncEvent({
      sessionId: targetSessionId,
      event: 'resolve_codex_session_start',
      detail: {
        requestId,
      },
    });

    try {
      const response = await api.codexSession(targetSessionId, { timeoutMs: PROJECTS_REQUEST_TIMEOUT_MS });
      if (!response.ok) {
        if (response.status !== 404) {
          throw new Error(`Codex session resolution failed with status ${response.status}`);
        }
        recordSessionSyncEvent({
          sessionId: targetSessionId,
          event: 'resolve_codex_session_not_found',
          detail: {
            status: response.status,
          },
        });
        return null;
      }

      const payload = (await response.json()) as ResolvedCodexSessionPayload;
      const resolvedProject = payload.project;
      if (!payload?.success || !resolvedProject) {
        return null;
      }

      const resolvedSession = (resolvedProject.codexSessions ?? []).find(
        (session) => session.id === targetSessionId,
      ) ?? payload.session ?? null;

      if (!resolvedSession?.id) {
        return null;
      }

      if (requestId !== codexRouteLookupSeqRef.current) {
        return null;
      }

      const normalizedSession = normalizeSessionProvider(resolvedSession, 'codex');
      const merged = mergeResolvedCodexProject(projectsRef.current, {
        ...resolvedProject,
        codexSessions: dedupeProjectSessions([
          normalizedSession,
          ...(resolvedProject.codexSessions ?? []),
        ]),
      });

      projectsRef.current = merged.projects;
      failedCodexRouteLookupRef.current = null;
      applyProjects(merged.projects);

      const selectedResolvedSession = normalizeSessionProvider(
        merged.project.codexSessions?.find((session) => session.id === targetSessionId) ?? normalizedSession,
        'codex',
      );

      setSelectedProject(merged.project);
      setSelectedSession(selectedResolvedSession);
      setRouteResolutionState('ready');
      setUnresolvedSessionId(null);
      recordSessionSyncEvent({
        sessionId: targetSessionId,
        event: 'resolve_codex_session_success',
        detail: {
          projectName: merged.project.name,
        },
      });

      return {
        project: merged.project,
        session: selectedResolvedSession,
      };
    } catch (error) {
      console.error('Error resolving Codex session target:', error);
      recordSessionSyncEvent({
        sessionId: targetSessionId,
        event: 'resolve_codex_session_error',
        detail: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    } finally {
      if (requestId === codexRouteLookupSeqRef.current) {
        if (codexRouteLookupInFlightRef.current === targetSessionId) {
          codexRouteLookupInFlightRef.current = null;
        }
      }
    }
  }, [applyProjects]);

  const fetchProjects = useCallback(async ({ showLoadingState = true }: FetchProjectsOptions = {}) => {
    let usedCachedBootstrap = false;
    recordSessionSyncEvent({
      sessionId: sessionId ?? null,
      event: 'projects_fetch_start',
      detail: {
        showLoadingState,
      },
    });

    try {
      if (showLoadingState) {
        setIsLoadingProjects(true);

        if (!hasHydratedProjectsCacheRef.current) {
          const cachedProjects = readProjectsBootstrapCache();
          if (cachedProjects.length > 0) {
            applyProjects(cachedProjects);
            hasHydratedProjectsCacheRef.current = true;
            usedCachedBootstrap = true;
            setIsLoadingProjects(false);
          }
        }
      }

      const response = await api.projects({ timeoutMs: PROJECTS_REQUEST_TIMEOUT_MS });
      if (!response.ok) {
        throw new Error(`Projects request failed with status ${response.status}`);
      }

      const projectData = (await response.json()) as Project[];
      hasHydratedProjectsCacheRef.current = true;
      applyProjects(projectData);
      recordSessionSyncEvent({
        sessionId: sessionId ?? null,
        event: 'projects_fetch_success',
        detail: {
          projectCount: projectData.length,
          usedCachedBootstrap,
        },
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
      recordSessionSyncEvent({
        sessionId: sessionId ?? null,
        event: 'projects_fetch_error',
        detail: {
          message: error instanceof Error ? error.message : String(error),
          usedCachedBootstrap,
        },
      });
      if (!usedCachedBootstrap && !hasHydratedProjectsCacheRef.current) {
        const cachedProjects = readProjectsBootstrapCache();
        if (cachedProjects.length > 0) {
          applyProjects(cachedProjects);
          hasHydratedProjectsCacheRef.current = true;
          usedCachedBootstrap = true;
        }
      }
    } finally {
      if (showLoadingState && !usedCachedBootstrap) {
        setIsLoadingProjects(false);
      }
    }
  }, [applyProjects, sessionId]);

  const refreshProjectsSilently = useCallback(async () => {
    // Keep chat view stable while still syncing sidebar/session metadata in background.
    await fetchProjects({ showLoadingState: false });
  }, [fetchProjects]);

  const openSettings = useCallback((tab = 'tools') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  // Auto-select the project when there is only one, so the user lands on the new session page
  useEffect(() => {
    if (!isLoadingProjects && projects.length === 1 && !selectedProject && !sessionId) {
      setSelectedProject(projects[0]);
    }
  }, [isLoadingProjects, projects, selectedProject, sessionId]);

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    if (latestMessage.type === 'websocket-reconnected') {
      recordSessionSyncEvent({
        sessionId: sessionId ?? selectedSession?.id ?? null,
        event: 'websocket_reconnected',
        detail: {
          selectedProject: selectedProject?.name ?? null,
          selectedSession: selectedSession?.id ?? null,
        },
      });
      void fetchProjects({ showLoadingState: false });
      if (sessionId && (!selectedSession || selectedSession.id !== sessionId || !selectedProject)) {
        setRouteResolutionState('resolving');
        setUnresolvedSessionId(sessionId);
      }
      return;
    }

    if (latestMessage.type === 'loading_progress') {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }

      setLoadingProgress(latestMessage as LoadingProgress);

      if (latestMessage.phase === 'complete') {
        loadingProgressTimeoutRef.current = setTimeout(() => {
          setLoadingProgress(null);
          loadingProgressTimeoutRef.current = null;
        }, 500);
      }

      return;
    }

    if (latestMessage.type !== 'projects_updated') {
      return;
    }

    const projectsMessage = latestMessage as ProjectsUpdatedMessage;
    recordSessionSyncEvent({
      sessionId: selectedSession?.id ?? sessionId ?? null,
      event: 'projects_updated_received',
      detail: {
        changedFile: projectsMessage.changedFile || null,
        projectCount: projectsMessage.projects?.length ?? 0,
      },
    });
    updateSessionSyncSnapshot({
      sessionId: selectedSession?.id ?? sessionId ?? null,
      selectedProject: selectedProject?.name ?? null,
      selectedSession: selectedSession?.id ?? null,
      projectsChangedFile: projectsMessage.changedFile || null,
    });

    if (IS_CODEX_ONLY_HARDENED) {
      if (hardenedProjectsRefreshTimeoutRef.current) {
        clearTimeout(hardenedProjectsRefreshTimeoutRef.current);
      }

      hardenedProjectsRefreshTimeoutRef.current = setTimeout(() => {
        hardenedProjectsRefreshTimeoutRef.current = null;
        void fetchProjects({ showLoadingState: false });
      }, 150);
    }

    if (projectsMessage.changedFile) {
      const normalized = projectsMessage.changedFile.replace(/\\/g, '/');
      const changedFileParts = normalized.split('/');

      if (changedFileParts.length >= 1) {
        const filename = changedFileParts[changedFileParts.length - 1];
        const changedSessionId = extractSessionIdFromJsonlFilename(filename);
        const currentRouteSessionId = selectedSession?.id ?? sessionId ?? unresolvedSessionId ?? null;

        if (changedSessionId && currentRouteSessionId && changedSessionId === currentRouteSessionId) {
          const isSessionProcessing = processingSessions.has(changedSessionId);
          const isSessionTerminal = terminalSessions.has(changedSessionId);

          if (!isSessionProcessing || isSessionTerminal) {
            setExternalMessageUpdate((prev) => prev + 1);
            recordSessionSyncEvent({
              sessionId: changedSessionId,
              event: 'external_message_update_triggered',
              detail: {
                changedFile: projectsMessage.changedFile,
                isSessionProcessing,
                isSessionTerminal,
              },
            });
          }

          if (
            IS_CODEX_ONLY_HARDENED
            && changedSessionId === sessionId
            && codexRouteLookupInFlightRef.current !== changedSessionId
            && failedCodexRouteLookupRef.current !== changedSessionId
          ) {
            void resolveCodexSessionFromServer(changedSessionId).then((result) => {
              if (!result && failedCodexRouteLookupRef.current !== changedSessionId) {
                failedCodexRouteLookupRef.current = changedSessionId;
              }
            });
          }
        }
      }
    }

    const hasActiveSession =
      (selectedSession && activeSessions.has(selectedSession.id)) ||
      (activeSessions.size > 0 && Array.from(activeSessions).some((id) => id.startsWith('new-session-')));

    const updatedProjects = projectsMessage.projects;

    if (
      hasActiveSession &&
      !isUpdateAdditive(projects, updatedProjects, selectedProject, selectedSession)
    ) {
      return;
    }

    setProjects(updatedProjects);
    writeProjectsBootstrapCache(updatedProjects);

    if (!selectedProject) {
      return;
    }

    const updatedSelectedProject = updatedProjects.find(
      (project) => project.name === selectedProject.name,
    );

    if (!updatedSelectedProject) {
      if (sessionId && selectedSession?.id === sessionId) {
        setRouteResolutionState('not_found');
        setUnresolvedSessionId(sessionId);
      }
      return;
    }

    if (serialize(updatedSelectedProject) !== serialize(selectedProject)) {
      setSelectedProject(updatedSelectedProject);
    }

    if (!selectedSession) {
      return;
    }

    const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
      (session) => session.id === selectedSession.id,
    );

    if (!updatedSelectedSession) {
      const shouldPreserveResolvedCodexSession =
        IS_CODEX_ONLY_HARDENED
        && Boolean(sessionId)
        && selectedSession.id === sessionId;

      if (shouldPreserveResolvedCodexSession) {
        if (
          sessionId
          && codexRouteLookupInFlightRef.current !== sessionId
          && failedCodexRouteLookupRef.current !== sessionId
        ) {
          void resolveCodexSessionFromServer(sessionId).then((result) => {
            if (!result && failedCodexRouteLookupRef.current !== sessionId) {
              failedCodexRouteLookupRef.current = sessionId;
            }
          });
        }
        return;
      }

      setSelectedSession(null);
      if (sessionId && selectedSession.id === sessionId) {
        setRouteResolutionState('not_found');
        setUnresolvedSessionId(sessionId);
      }
    } else if (sessionId && updatedSelectedSession.id === sessionId) {
      setRouteResolutionState('ready');
      setUnresolvedSessionId(null);
    }
  }, [
    latestMessage,
    selectedProject,
    selectedSession,
    activeSessions,
    processingSessions,
    terminalSessions,
    projects,
    fetchProjects,
    resolveCodexSessionFromServer,
    sessionId,
    unresolvedSessionId,
  ]);

  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
      if (hardenedProjectsRefreshTimeoutRef.current) {
        clearTimeout(hardenedProjectsRefreshTimeoutRef.current);
        hardenedProjectsRefreshTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setRouteResolutionState('ready');
      setUnresolvedSessionId(null);
      return;
    }

    if (selectedSession?.id === sessionId && selectedProject) {
      setRouteResolutionState('ready');
      setUnresolvedSessionId(null);
      return;
    }

    if (projects.length === 0) {
      setRouteResolutionState(isLoadingProjects ? 'resolving' : 'not_found');
      setUnresolvedSessionId(sessionId);
      return;
    }

    const resolvedTarget = resolveSessionTarget(projects, sessionId);
    if (resolvedTarget) {
      failedCodexRouteLookupRef.current = null;
      const shouldUpdateProject = selectedProject?.name !== resolvedTarget.project.name;
      const shouldUpdateSession =
        selectedSession?.id !== resolvedTarget.session.id
        || selectedSession?.__provider !== resolvedTarget.session.__provider;

      if (shouldUpdateProject) {
        setSelectedProject(resolvedTarget.project);
      }

      if (shouldUpdateSession) {
        setSelectedSession(resolvedTarget.session);
      }

      setRouteResolutionState('ready');
      setUnresolvedSessionId(null);
      return;
    }

    if (IS_CODEX_ONLY_HARDENED) {
      if (failedCodexRouteLookupRef.current === sessionId) {
        setRouteResolutionState(isLoadingProjects ? 'resolving' : 'not_found');
        setUnresolvedSessionId(sessionId);
        return;
      }

      if (codexRouteLookupInFlightRef.current !== sessionId) {
        void resolveCodexSessionFromServer(sessionId).then((result) => {
          if (!result) {
            failedCodexRouteLookupRef.current = sessionId;
            setRouteResolutionState('not_found');
            setUnresolvedSessionId(sessionId);
          }
        });
      }

      setRouteResolutionState('resolving');
      setUnresolvedSessionId(sessionId);
      return;
    }

    setRouteResolutionState(isLoadingProjects ? 'resolving' : 'not_found');
    setUnresolvedSessionId(sessionId);
  }, [isLoadingProjects, projects, resolveCodexSessionFromServer, selectedProject, selectedSession, sessionId]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setRouteResolutionState('ready');
      setUnresolvedSessionId(null);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      const resolvedTarget =
        resolveSessionTarget(projects, session.id)
        || (session.__projectName
          ? projects
              .filter((project) => project.name === session.__projectName)
              .map((project) => ({ project, session }))
              .at(0) || null
          : null);

      if (resolvedTarget) {
        if (selectedProject?.name !== resolvedTarget.project.name) {
          setSelectedProject(resolvedTarget.project);
        }
        setSelectedSession(resolvedTarget.session);
      } else {
        setSelectedSession(session);
      }

      setRouteResolutionState('ready');
      setUnresolvedSessionId(null);

      if (activeTab === 'tasks' || activeTab === 'preview') {
        setActiveTab('chat');
      }

      if (!IS_CODEX_ONLY_HARDENED && session.__provider === 'cursor') {
        sessionStorage.setItem('cursorSessionId', session.id);
      }

      if (isMobile) {
        const sessionProjectName = session.__projectName;
        const currentProjectName = selectedProject?.name;

        if (sessionProjectName !== currentProjectName) {
          setSidebarOpen(false);
        }
      }

      navigate(`/session/${session.id}`);
    },
    [activeTab, isMobile, navigate, projects, selectedProject?.name],
  );

  const handleNewSession = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setRouteResolutionState('ready');
      setUnresolvedSessionId(null);
      setActiveTab('chat');
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      if (selectedSession?.id === sessionIdToDelete) {
        setSelectedSession(null);
        if (sessionId === sessionIdToDelete) {
          setRouteResolutionState('not_found');
          setUnresolvedSessionId(sessionIdToDelete);
        } else {
          navigate('/');
        }
      }

      setProjects((prevProjects) =>
        prevProjects.map((project) => ({
          ...project,
          sessions: project.sessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
          codexSessions: project.codexSessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
          sessionMeta: {
            ...project.sessionMeta,
            total: Math.max(0, (project.sessionMeta?.total as number | undefined ?? 0) - 1),
          },
        })),
      );
    },
    [navigate, selectedSession?.id, sessionId],
  );

  const handleSidebarRefresh = useCallback(async () => {
    try {
      const response = await api.projects({ timeoutMs: PROJECTS_REQUEST_TIMEOUT_MS });
      if (!response.ok) {
        throw new Error(`Projects request failed with status ${response.status}`);
      }
      const freshProjects = (await response.json()) as Project[];

      applyProjects(freshProjects);

      if (!selectedProject) {
        return;
      }

      const refreshedProject = freshProjects.find((project) => project.name === selectedProject.name);
      if (!refreshedProject) {
        return;
      }

      if (serialize(refreshedProject) !== serialize(selectedProject)) {
        setSelectedProject(refreshedProject);
      }

      if (!selectedSession) {
        return;
      }

      const refreshedSession = getProjectSessions(refreshedProject).find(
        (session) => session.id === selectedSession.id,
      );

      if (refreshedSession) {
        // Keep provider metadata stable when refreshed payload doesn't include __provider.
        const normalizedRefreshedSession =
          refreshedSession.__provider || !selectedSession.__provider
            ? refreshedSession
            : { ...refreshedSession, __provider: selectedSession.__provider };

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      } else if (sessionId && selectedSession.id === sessionId) {
        setRouteResolutionState('not_found');
        setUnresolvedSessionId(sessionId);
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [applyProjects, selectedProject, selectedSession, sessionId]);

  const handleProjectDelete = useCallback(
    (projectName: string) => {
      if (selectedProject?.name === projectName) {
        setSelectedProject(null);
        setSelectedSession(null);
        setRouteResolutionState('ready');
        setUnresolvedSessionId(null);
        navigate('/');
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.name !== projectName));
    },
    [navigate, selectedProject?.name],
  );

  useEffect(() => {
    if (lastRouteResolutionStateRef.current === routeResolutionState) {
      return;
    }

    lastRouteResolutionStateRef.current = routeResolutionState;
    recordSessionSyncEvent({
      sessionId: selectedSession?.id ?? sessionId ?? unresolvedSessionId ?? null,
      event: 'route_resolution_state_changed',
      detail: {
        routeResolutionState,
        unresolvedSessionId,
      },
    });
  }, [routeResolutionState, selectedSession?.id, sessionId, unresolvedSessionId]);

  useEffect(() => {
    updateSessionSyncSnapshot({
      sessionId: selectedSession?.id ?? sessionId ?? unresolvedSessionId ?? null,
      selectedProject: selectedProject?.name ?? null,
      selectedSession: selectedSession?.id ?? null,
      externalMessageUpdate,
      routeResolutionState,
      projectsChangedFile: null,
    });
  }, [
    externalMessageUpdate,
    routeResolutionState,
    selectedProject?.name,
    selectedSession?.id,
    sessionId,
    unresolvedSessionId,
  ]);

  const sidebarSharedProps = useMemo(
    () => ({
      projects,
      selectedProject,
      selectedSession,
      onProjectSelect: handleProjectSelect,
      onSessionSelect: handleSessionSelect,
      onNewSession: handleNewSession,
      onSessionDelete: handleSessionDelete,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: () => setShowSettings(true),
      showSettings,
      settingsInitialTab,
      onCloseSettings: () => setShowSettings(false),
      isMobile,
    }),
    [
      handleNewSession,
      handleProjectDelete,
      handleProjectSelect,
      handleSessionDelete,
      handleSessionSelect,
      handleSidebarRefresh,
      isLoadingProjects,
      isMobile,
      loadingProgress,
      projects,
      settingsInitialTab,
      selectedProject,
      selectedSession,
      showSettings,
    ],
  );

  return {
    projects,
    selectedProject,
    selectedSession,
    routeResolutionState,
    unresolvedSessionId,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    loadingProgress,
    isInputFocused,
    showSettings,
    settingsInitialTab,
    externalMessageUpdate,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    fetchProjects,
    refreshProjectsSilently,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleNewSession,
    handleSessionDelete,
    handleProjectDelete,
    handleSidebarRefresh,
  };
}
