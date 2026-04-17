import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2, MessageSquareText, Search, X } from 'lucide-react';
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
                mode === item.id
                  ? 'bg-primary text-primary-foreground'
                  : 'mobile-pill text-foreground'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {mode === 'projects' ? (
          <div className="space-y-4">
            {filteredProjects.map((project) => {
              const sessions = getAllSessions(project, {}).slice(0, query.trim() ? 6 : 3);
              return (
                <section key={project.name} className="mobile-card mobile-shadow p-4">
                  <button
                    type="button"
                    onClick={() => {
                      onProjectSelect(project);
                      onClose();
                    }}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <div className="min-w-0">
                      <div className="mobile-clamp-1 text-[17px] font-semibold text-foreground">
                        {project.displayName || project.name}
                      </div>
                      <div className="mt-1 text-[13px] mobile-muted-text">
                        {sessions.length ? `${sessions.length} recent sessions` : 'No sessions yet'}
                      </div>
                    </div>
                    <div className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                      Open
                    </div>
                  </button>

                  <div className="mt-3 space-y-2">
                    {sessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => {
                          onSessionSelect(session as ProjectSession);
                          onClose();
                        }}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-primary/60" />
                        <div className="min-w-0 flex-1">
                          <div className="mobile-clamp-1 text-[14px] text-foreground">
                            {String((session as Record<string, unknown>).summary || (session as Record<string, unknown>).name || 'Conversation')}
                          </div>
                        </div>
                        <div className="mobile-tabular text-[12px] mobile-muted-text">
                          {formatRelativeTime(String((session as Record<string, unknown>).lastActivity || (session as Record<string, unknown>).createdAt || ''))}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}

            {!filteredProjects.length ? (
              <div className="mobile-card p-6 text-center text-[14px] mobile-muted-text">
                No matching projects found.
              </div>
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
                <div className="text-[16px] font-semibold text-foreground">
                  {projectResult.projectDisplayName || projectResult.projectName}
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
                      className="mobile-pill block w-full px-4 py-3 text-left"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                          <MessageSquareText className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mobile-clamp-1 text-[14px] font-medium text-foreground">
                            {session.sessionSummary || 'Conversation'}
                          </div>
                          {session.matches[0] ? (
                            <div className="mobile-clamp-3 mt-1 text-[13px] leading-6 mobile-muted-text">
                              {session.matches[0].snippet}
                            </div>
                          ) : null}
                        </div>
                        <div className="mobile-tabular text-[12px] mobile-muted-text">
                          {formatRelativeTime(session.matches[0]?.timestamp || null)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}

            {!isSearching && conversationResults && conversationResults.results.length === 0 ? (
              <div className="mobile-card p-6 text-center text-[14px] mobile-muted-text">
                No matching conversation content found.
              </div>
            ) : null}

            {!query.trim() ? (
              <div className="mobile-card p-6 text-center text-[14px] mobile-muted-text">
                Enter at least two characters to start streaming a conversation search.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
