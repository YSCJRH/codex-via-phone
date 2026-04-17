import { useMemo, useState } from 'react';
import {
  ChevronRight,
  Clock3,
  Folder,
  MessageSquarePlus,
  MonitorSmartphone,
  Puzzle,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Wifi,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Project, ProjectSession } from '../../types/app';
import { IS_CODEX_ONLY_HARDENED } from '../../constants/config';
import { getAllSessions, getSessionDate } from '../sidebar/utils/utils';
import type { DesktopApprovalBridgeStatus } from './DesktopApprovalOverlay';

type MobileHomeScreenProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onNewSession: (project: Project) => void;
  onShowSettings: () => void;
  onOpenSearch: () => void;
  onOpenMore: () => void;
  onOpenTasks: () => void;
  desktopApprovalBridgeStatus: DesktopApprovalBridgeStatus | null;
  desktopApprovalCount: number;
  isConnected: boolean;
};

type QuickAction = {
  id: string;
  label: string;
  icon: typeof Search;
  onClick: () => void;
};

function formatRelativeTime(value?: string | null) {
  if (!value) {
    return 'just now';
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return 'just now';
  }

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp.getTime()) / 60000));
  if (diffMinutes < 1) {
    return 'just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hr ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays} d ago`;
  }

  return timestamp.toLocaleString();
}

function buildSessionPreview(session: ProjectSession, fallbackLabel: string) {
  const payload = session as Record<string, unknown>;
  return {
    id: session.id,
    name: String(payload.summary || payload.name || fallbackLabel),
    time: String(payload.lastActivity || payload.createdAt || payload.created_at || ''),
  };
}

export default function MobileHomeScreen({
  projects,
  selectedProject,
  selectedSession,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onShowSettings,
  onOpenSearch,
  onOpenMore,
  onOpenTasks,
  desktopApprovalBridgeStatus,
  desktopApprovalCount,
  isConnected,
}: MobileHomeScreenProps) {
  const { t } = useTranslation(['common', 'sidebar']);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

  const sortedProjects = useMemo(() => {
    return [...projects].sort((left, right) => {
      const leftSessions = getAllSessions(left, {});
      const rightSessions = getAllSessions(right, {});
      const leftDate = leftSessions.length ? getSessionDate(leftSessions[0]).getTime() : 0;
      const rightDate = rightSessions.length ? getSessionDate(rightSessions[0]).getTime() : 0;
      return rightDate - leftDate;
    });
  }, [projects]);

  const defaultProject = selectedProject || sortedProjects[0] || null;
  const bridgeHeadline = desktopApprovalBridgeStatus?.active
    ? 'Bridge online'
    : desktopApprovalBridgeStatus?.enabled
      ? 'Waiting on desktop'
      : 'Bridge disabled';
  const bridgeDetail = desktopApprovalBridgeStatus?.active
    ? (
        desktopApprovalBridgeStatus.enabledUntil
          ? `Enabled until ${formatRelativeTime(desktopApprovalBridgeStatus.enabledUntil)}`
          : 'Desktop approvals can be mirrored to mobile.'
      )
    : desktopApprovalBridgeStatus?.message || 'Enable desktop approvals on the computer first.';

  const quickActions: QuickAction[] = [
    {
      id: 'new-chat',
      label: 'New chat',
      icon: MessageSquarePlus,
      onClick: () => {
        if (defaultProject) {
          onNewSession(defaultProject);
        } else {
          onOpenSearch();
        }
      },
    },
    {
      id: 'search',
      label: 'Search',
      icon: Search,
      onClick: onOpenSearch,
    },
    ...(IS_CODEX_ONLY_HARDENED
      ? []
      : [
          {
            id: 'plugins',
            label: 'Plugins',
            icon: Puzzle,
            onClick: onOpenMore,
          },
          {
            id: 'automation',
            label: 'Automation',
            icon: Sparkles,
            onClick: onOpenTasks,
          },
        ]),
    {
      id: 'devices',
      label: 'Devices',
      icon: MonitorSmartphone,
      onClick: onShowSettings,
    },
  ];

  return (
    <div className="mobile-shell flex h-full flex-col">
      <div className="mobile-safe-top flex-shrink-0 px-5 pb-4 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-medium uppercase tracking-[0.18em] text-primary/75">
              Codex
            </div>
            <div className="mt-2 text-[31px] font-semibold tracking-tight text-foreground">
              Codex
            </div>
          </div>

          <button
            type="button"
            onClick={onShowSettings}
            className="mobile-pill mobile-shadow inline-flex items-center gap-2 px-4 py-3 text-sm font-medium text-foreground"
          >
            <Settings className="h-4.5 w-4.5" />
            Settings
          </button>
        </div>
      </div>

      <div className="mobile-home-scroll flex-1 overflow-y-auto px-5">
        <div className="grid grid-cols-2 gap-3 pb-5">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                onClick={action.onClick}
                className="mobile-card mobile-shadow flex items-center gap-3 px-4 py-4 text-left transition-transform duration-200 active:scale-[0.99]"
              >
                <div className="mobile-pill inline-flex h-11 w-11 flex-shrink-0 items-center justify-center text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-[15px] font-medium text-foreground">{action.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mobile-card mobile-shadow p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[13px] font-medium uppercase tracking-[0.12em] mobile-muted-text">
                Device state
              </div>
              <div className="mt-2 text-[22px] font-semibold tracking-tight text-foreground">
                {bridgeHeadline}
              </div>
              <p className="mt-2 text-[14px] leading-6 mobile-subtle-text">
                {bridgeDetail}
              </p>
            </div>
            <div className="mobile-pill inline-flex h-12 w-12 flex-shrink-0 items-center justify-center text-primary">
              <ShieldCheck className="h-5.5 w-5.5" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="mobile-pill px-3.5 py-3">
              <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                <Wifi className={`h-4 w-4 ${isConnected ? 'text-emerald-500' : 'text-amber-500'}`} />
                {isConnected ? 'Connection live' : 'Connection lost'}
              </div>
              <div className="mt-2 text-[12px] mobile-muted-text">
                {isConnected ? 'Mobile is synced with the desktop bridge.' : 'Waiting to reconnect to the desktop session.'}
              </div>
            </div>

            <div className="mobile-pill px-3.5 py-3">
              <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                <Clock3 className="h-4 w-4 text-primary" />
                {desktopApprovalCount} pending
              </div>
              <div className="mt-2 text-[12px] mobile-muted-text">
                {desktopApprovalCount > 0 ? 'Desktop approvals are waiting in matching threads.' : 'No new desktop approvals are waiting.'}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium uppercase tracking-[0.12em] mobile-muted-text">
              Projects
            </div>
            <div className="mt-1 text-[15px] mobile-subtle-text">
              Resume the most recent Codex work that is still running on the computer.
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenSearch}
            className="mobile-pill inline-flex h-11 w-11 items-center justify-center text-muted-foreground"
            aria-label="Search projects"
          >
            <Search className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="mt-4 space-y-4 pb-6">
          {!sortedProjects.length ? (
            <section className="mobile-card mobile-shadow p-5">
              <div className="text-[18px] font-semibold text-foreground">No projects yet</div>
              <p className="mt-2 text-[14px] leading-6 mobile-subtle-text">
                Finish setup or import a workspace on the computer first. Mobile will list resumable local Codex projects here once they are available.
              </p>
            </section>
          ) : null}

          {sortedProjects.map((project) => {
            const sessions = getAllSessions(project, {});
            const sessionLimit = expandedProjects[project.name] ? 6 : 3;
            const visibleSessions = sessions.slice(0, sessionLimit);
            const isCurrentProject = selectedProject?.name === project.name;

            return (
              <section
                key={project.name}
                className={`mobile-card mobile-shadow overflow-hidden p-4 ${isCurrentProject ? 'ring-1 ring-primary/25' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => onProjectSelect(project)}
                  className="flex w-full items-start gap-3 text-left"
                >
                  <div className="mobile-pill inline-flex h-12 w-12 flex-shrink-0 items-center justify-center text-primary">
                    <Folder className="h-5.5 w-5.5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mobile-clamp-1 text-[19px] font-semibold tracking-tight text-foreground">
                      {project.displayName || project.name}
                    </div>
                    <div className="mt-1 text-[13px] mobile-muted-text">
                      {sessions.length > 0
                        ? `${sessions.length} sessions / updated ${formatRelativeTime(buildSessionPreview(sessions[0], t('projects.newSession')).time)}`
                        : 'No sessions yet'}
                    </div>
                  </div>

                  <ChevronRight className="mt-1 h-4.5 w-4.5 flex-shrink-0 text-muted-foreground" />
                </button>

                <div className="mobile-divider mt-4" />

                <div className="mt-4 space-y-1">
                  {visibleSessions.length > 0 ? visibleSessions.map((session) => {
                    const preview = buildSessionPreview(session, t('projects.newSession'));
                    const isCurrentSession = selectedSession?.id === session.id;

                    return (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => onSessionSelect(session)}
                        className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
                          isCurrentSession ? 'bg-primary/10 dark:bg-primary/15' : 'hover:bg-muted/40'
                        }`}
                      >
                        <div className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${isCurrentSession ? 'bg-primary' : 'bg-primary/55 dark:bg-primary/65'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="mobile-clamp-1 text-[15px] leading-6 text-foreground">
                            {preview.name}
                          </div>
                        </div>
                        <div className="mobile-tabular flex-shrink-0 text-[13px] mobile-muted-text">
                          {formatRelativeTime(preview.time)}
                        </div>
                      </button>
                    );
                  }) : (
                    <div className="rounded-2xl px-3 py-4 text-[14px] mobile-muted-text">
                      No resumable mobile session is available in this project yet.
                    </div>
                  )}
                </div>

                {sessions.length > sessionLimit ? (
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedProjects((previous) => ({
                        ...previous,
                        [project.name]: !previous[project.name],
                      }));
                    }}
                    className="mt-2 text-[14px] font-medium text-primary"
                  >
                    {expandedProjects[project.name] ? 'Show less' : 'Show more'}
                  </button>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
