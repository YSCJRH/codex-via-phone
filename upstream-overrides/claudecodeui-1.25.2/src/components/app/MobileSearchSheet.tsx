import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Clock3,
  Loader2,
  MessageSquareText,
  Search,
  SearchSlash,
  Sparkles,
  X,
} from 'lucide-react';
import type { Project, ProjectSession, SessionProvider } from '../../types/app';
import { api } from '../../utils/api';
import { getAllSessions } from '../sidebar/utils/utils';

type SnippetHighlight = {
  start: number;
  end: number;
};

type ConversationMatch = {
  role: string;
  snippet: string;
  highlights: SnippetHighlight[];
  timestamp: string | null;
  provider?: string;
};

type ConversationSession = {
  sessionId: string;
  sessionSummary: string;
  provider?: string;
  matches: ConversationMatch[];
};

type ConversationProjectResult = {
  projectName: string;
  projectDisplayName: string;
  sessions: ConversationSession[];
};

type ConversationSearchResults = {
  results: ConversationProjectResult[];
  totalMatches: number;
  query: string;
};

type SearchProgress = {
  scannedProjects: number;
  totalProjects: number;
};

type MobileSearchSheetProps = {
  open: boolean;
  projects: Project[];
  onClose: () => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
};

type ProjectSearchCard = {
  project: Project;
  sessions: ProjectSession[];
};

function normalizeProvider(value?: string): SessionProvider {
  if (value === 'cursor' || value === 'gemini' || value === 'codex') {
    return value;
  }
  return 'claude';
}

function formatRelativeTime(value?: string | null) {
  if (!value) {
    return 'just now';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'just now';
  }

  const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  if (diffMinutes < 24 * 60) return `${Math.round(diffMinutes / 60)} hr ago`;
  return `${Math.round(diffMinutes / (60 * 24))} d ago`;
}

function getProviderLabel(value?: string) {
  return normalizeProvider(value).toUpperCase();
}

function EmptyState({
  title,
  description,
  searching = false,
}: {
  title: string;
  description: string;
  searching?: boolean;
}) {
  const Icon = searching ? Loader2 : SearchSlash;

  return (
    <div className="mobile-card mobile-shadow p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className={`h-5 w-5 ${searching ? 'animate-spin' : ''}`} />
      </div>
      <div className="mt-4 text-[16px] font-semibold text-foreground">{title}</div>
      <div className="mt-2 text-[14px] leading-6 mobile-muted-text">{description}</div>
    </div>
  );
}

export default function MobileSearchSheet({
  open,
  projects,
  onClose,
  onProjectSelect,
  onSessionSelect,
}: MobileSearchSheetProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'projects' | 'conversations'>('projects');
  const [conversationResults, setConversationResults] = useState<ConversationSearchResults | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<SearchProgress | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return projects;
    }

    return projects.filter((project) => {
      const projectName = String(project.name || '').toLowerCase();
      const displayName = String(project.displayName || project.name || '').toLowerCase();
      return projectName.includes(normalizedQuery) || displayName.includes(normalizedQuery);
    });
  }, [projects, query]);

  const projectCards = useMemo<ProjectSearchCard[]>(() => {
    return filteredProjects.map((project) => ({
      project,
      sessions: getAllSessions(project, {}).slice(0, query.trim() ? 6 : 3) as ProjectSession[],
    }));
  }, [filteredProjects, query]);

  const conversationProjectCount = conversationResults?.results.length || 0;
  const conversationSessionCount = useMemo(
    () => conversationResults?.results.reduce((sum, project) => sum + project.sessions.length, 0) || 0,
    [conversationResults]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const trimmedQuery = query.trim();
    if (mode !== 'conversations' || trimmedQuery.length < 2) {
      searchSeqRef.current += 1;
      setConversationResults(null);
      setSearchProgress(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const seq = ++searchSeqRef.current;

    searchTimeoutRef.current = setTimeout(() => {
      if (seq !== searchSeqRef.current) {
        return;
      }

      const source = new EventSource(api.searchConversationsUrl(trimmedQuery));
      eventSourceRef.current = source;
      const accumulated: ConversationProjectResult[] = [];

      source.addEventListener('result', (event) => {
        if (seq !== searchSeqRef.current) {
          source.close();
          return;
        }

        try {
          const payload = JSON.parse(event.data) as {
            projectResult: ConversationProjectResult;
            totalMatches: number;
            scannedProjects: number;
            totalProjects: number;
          };
          accumulated.push(payload.projectResult);
          setConversationResults({
            results: [...accumulated],
            totalMatches: payload.totalMatches,
            query: trimmedQuery,
          });
          setSearchProgress({
            scannedProjects: payload.scannedProjects,
            totalProjects: payload.totalProjects,
          });
        } catch {
          // Ignore malformed SSE payloads so the search UI stays stable.
        }
      });

      source.addEventListener('progress', (event) => {
        if (seq !== searchSeqRef.current) {
          source.close();
          return;
        }

        try {
          const payload = JSON.parse(event.data) as SearchProgress & { totalMatches: number };
          setSearchProgress({
            scannedProjects: payload.scannedProjects,
            totalProjects: payload.totalProjects,
          });
        } catch {
          // Ignore malformed SSE payloads so the search UI stays stable.
        }
      });

      source.addEventListener('done', () => {
        if (seq !== searchSeqRef.current) {
          source.close();
          return;
        }
        source.close();
        eventSourceRef.current = null;
        setIsSearching(false);
        setSearchProgress(null);
        if (!accumulated.length) {
          setConversationResults({ results: [], totalMatches: 0, query: trimmedQuery });
        }
      });

      source.addEventListener('error', () => {
        if (seq !== searchSeqRef.current) {
          source.close();
          return;
        }
        source.close();
        eventSourceRef.current = null;
        setIsSearching(false);
        setSearchProgress(null);
        if (!accumulated.length) {
          setConversationResults({ results: [], totalMatches: 0, query: trimmedQuery });
        }
      });
    }, 280);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [mode, open, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setMode('projects');
      setConversationResults(null);
      setSearchProgress(null);
      setIsSearching(false);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[88] flex flex-col bg-background/98 sm:hidden">
      <div className="mobile-safe-top mobile-surface flex-shrink-0 border-x-0 border-t-0 px-4 pb-4 pt-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="mobile-pill inline-flex h-11 w-11 items-center justify-center text-foreground"
            aria-label="Close search"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={mode === 'projects' ? 'Search project names' : 'Search conversation content'}
              className="w-full rounded-[22px] border border-border/60 bg-card px-11 py-3.5 text-[15px] text-foreground outline-none transition-shadow focus:shadow-sm focus:ring-2 focus:ring-primary/20"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            { id: 'projects', label: 'Projects' },
            { id: 'conversations', label: 'Conversations' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id as 'projects' | 'conversations')}
              className={`rounded-[18px] px-4 py-3 text-sm font-medium transition-colors ${
                mode === item.id ? 'bg-primary text-primary-foreground' : 'mobile-pill text-foreground'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-4 mobile-card px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="mobile-pill inline-flex h-10 w-10 flex-shrink-0 items-center justify-center text-primary">
              <Sparkles className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium uppercase tracking-[0.12em] mobile-muted-text">
                Search summary
              </div>
              {mode === 'projects' ? (
                <>
                  <div className="mt-2 text-[15px] font-medium leading-6 text-foreground">
                    {query.trim()
                      ? `Showing ${projectCards.length} matching projects`
                      : `Browse ${projectCards.length} available projects`}
                  </div>
                  <div className="mt-1 text-[13px] leading-5 mobile-muted-text">
                    Search by project name, then jump straight into the workspace or one of its recent sessions.
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="mobile-pill px-3 py-1 text-[12px] font-medium text-foreground">
                      {query.trim() ? `${conversationProjectCount} projects` : 'Waiting for query'}
                    </span>
                    <span className="mobile-pill px-3 py-1 text-[12px] font-medium text-foreground">
                      {query.trim() ? `${conversationSessionCount} sessions` : '2+ chars needed'}
                    </span>
                    {conversationResults ? (
                      <span className="mobile-pill px-3 py-1 text-[12px] font-medium text-primary">
                        {conversationResults.totalMatches} matches
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 text-[13px] leading-5 mobile-muted-text">
                    Stream full-text search across projects, then reopen the exact thread from its first matching snippet.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {mode === 'projects' ? (
          <div className="space-y-4">
            {projectCards.map(({ project, sessions }) => (
              <section key={project.name} className="mobile-card mobile-shadow p-4">
                <button
                  type="button"
                  onClick={() => {
                    onProjectSelect(project);
                    onClose();
                  }}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="mobile-clamp-1 text-[17px] font-semibold text-foreground">
                        {project.displayName || project.name}
                      </div>
                      <span className="mobile-pill px-2.5 py-1 text-[11px] font-medium text-foreground">
                        {sessions.length ? `${sessions.length} recent` : 'Empty'}
                      </span>
                    </div>
                    <div className="mt-1 text-[13px] mobile-muted-text">
                      {sessions.length
                        ? 'Open the project or jump into one of its latest conversations.'
                        : 'This project is available, but it does not have recent sessions yet.'}
                    </div>
                  </div>
                  <div className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                    Open
                  </div>
                </button>

                {sessions.length ? (
                  <div className="mt-3 space-y-2">
                    {sessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => {
                          onSessionSelect(session as ProjectSession);
                          onClose();
                        }}
                        className="flex w-full items-center gap-3 rounded-2xl border border-border/40 bg-background/45 px-3 py-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <MessageSquareText className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mobile-clamp-1 text-[14px] font-medium text-foreground">
                            {String((session as Record<string, unknown>).summary || (session as Record<string, unknown>).name || 'Conversation')}
                          </div>
                          <div className="mt-1 text-[12px] leading-5 mobile-muted-text">
                            Recent thread inside this project
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-[12px] mobile-muted-text">
                          <Clock3 className="h-3.5 w-3.5" />
                          <span className="mobile-tabular">
                            {formatRelativeTime(String((session as Record<string, unknown>).lastActivity || (session as Record<string, unknown>).createdAt || ''))}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-border/50 bg-background/35 px-4 py-4 text-[13px] leading-5 mobile-muted-text">
                    No recent sessions yet. Open the project to start a new conversation from mobile.
                  </div>
                )}
              </section>
            ))}

            {!projectCards.length ? (
              <EmptyState
                title="No matching projects"
                description="Try a different project name, or clear the search to browse everything again."
              />
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            {isSearching ? (
              <div className="mobile-card flex items-center gap-3 px-4 py-4 text-[14px] mobile-muted-text">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {searchProgress
                  ? `Scanned ${searchProgress.scannedProjects}/${searchProgress.totalProjects} projects`
                  : 'Searching conversation content'}
              </div>
            ) : null}

            {conversationResults?.results.map((projectResult) => (
              <section key={projectResult.projectName} className="mobile-card mobile-shadow p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mobile-clamp-1 text-[16px] font-semibold text-foreground">
                      {projectResult.projectDisplayName || projectResult.projectName}
                    </div>
                    <div className="mt-1 text-[13px] leading-5 mobile-muted-text">
                      {`${projectResult.sessions.length} matching sessions in this project`}
                    </div>
                  </div>
                  <span className="mobile-pill px-3 py-1 text-[11px] font-medium text-primary">
                    Matched
                  </span>
                </div>

                <div className="mt-3 space-y-3">
                  {projectResult.sessions.map((session) => (
                    <button
                      key={session.sessionId}
                      type="button"
                      onClick={() => {
                        onSessionSelect({
                          id: session.sessionId,
                          summary: session.sessionSummary,
                          __provider: normalizeProvider(session.provider),
                          __projectName: projectResult.projectName,
                        } as ProjectSession);
                        onClose();
                      }}
                      className="block w-full rounded-[1.3rem] border border-border/45 bg-background/55 px-4 py-4 text-left transition-colors hover:bg-muted/40"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                          <MessageSquareText className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="mobile-clamp-1 text-[14px] font-medium text-foreground">
                              {session.sessionSummary || 'Conversation'}
                            </div>
                            <span className="mobile-pill px-2 py-0.5 text-[10px] font-medium text-foreground">
                              {getProviderLabel(session.provider || session.matches[0]?.provider)}
                            </span>
                            <span className="mobile-pill px-2 py-0.5 text-[10px] font-medium text-primary">
                              {`${session.matches.length} hit${session.matches.length === 1 ? '' : 's'}`}
                            </span>
                          </div>
                          {session.matches[0] ? (
                            <div className="mt-2 rounded-2xl bg-muted/35 px-3 py-3 text-[13px] leading-6 mobile-subtle-text">
                              {session.matches[0].snippet}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1.5 text-[12px] mobile-muted-text">
                          <Clock3 className="h-3.5 w-3.5" />
                          <span className="mobile-tabular">
                            {formatRelativeTime(session.matches[0]?.timestamp || null)}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}

            {!query.trim() ? (
              <EmptyState
                title="Search inside conversations"
                description="Enter at least two characters to start streaming a full-text conversation search across your projects."
              />
            ) : null}

            {!isSearching && conversationResults && conversationResults.results.length === 0 ? (
              <EmptyState
                title="No matching conversation content"
                description="Try a broader phrase, or switch to Projects if you only need to find the workspace first."
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
