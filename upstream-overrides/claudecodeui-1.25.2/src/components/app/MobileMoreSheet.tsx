import {
  ChevronRight,
  Folder,
  GitBranch,
  ListChecks,
  MessageSquareText,
  Puzzle,
  Settings,
  Sparkles,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppTab, Project } from '../../types/app';
import { usePlugins } from '../../contexts/PluginsContext';
import { useTasksSettings } from '../../contexts/TasksSettingsContext';
import { IS_CODEX_ONLY_HARDENED } from '../../constants/config';
import MobileBottomSheet from './MobileBottomSheet';

type MobileMoreSheetProps = {
  open: boolean;
  activeTab: AppTab;
  selectedProject: Project | null;
  onClose: () => void;
  onSelectTab: (tab: AppTab) => void;
  onShowSettings: () => void;
  onGoHome: () => void;
};

type MoreAction = {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  tab?: AppTab;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
};

function getActiveSurfaceLabel(activeTab: AppTab) {
  if (activeTab === 'chat') return 'Chat';
  if (activeTab === 'files') return 'Files';
  if (activeTab === 'shell') return 'Shell';
  if (activeTab === 'git') return 'Git';
  if (activeTab === 'tasks') return 'Automation';
  if (activeTab.startsWith('plugin:')) return 'Plugin';
  return 'Workspace';
}

function ActionRow({
  label,
  hint,
  badge,
  icon: Icon,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  hint: string;
  badge?: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`mobile-card mobile-shadow flex w-full items-center gap-3 px-4 py-4 text-left transition-all ${
        disabled ? 'cursor-not-allowed opacity-55' : 'active:scale-[0.99]'
      } ${active ? 'ring-1 ring-primary/25' : ''}`}
    >
      <div className={`mobile-pill inline-flex h-11 w-11 flex-shrink-0 items-center justify-center ${
        active ? 'text-primary' : 'text-foreground'
      }`}>
        <Icon className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mobile-clamp-1 text-[15px] font-medium text-foreground">{label}</div>
          {badge ? (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${
              disabled
                ? 'bg-muted/65 text-muted-foreground'
                : active
                  ? 'bg-primary/12 text-primary'
                  : 'bg-foreground/6 text-foreground/70'
            }`}>
              {badge}
            </span>
          ) : null}
        </div>
        <div className="mobile-clamp-2 mt-1 text-[13px] leading-5 mobile-muted-text">{hint}</div>
      </div>

      {active ? (
        <div className="rounded-full bg-primary/12 px-2.5 py-1 text-[11px] font-medium text-primary">
          Current
        </div>
      ) : !disabled ? (
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      ) : null}
    </button>
  );
}

export default function MobileMoreSheet({
  open,
  activeTab,
  selectedProject,
  onClose,
  onSelectTab,
  onShowSettings,
  onGoHome,
}: MobileMoreSheetProps) {
  const { t } = useTranslation('common');
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { plugins } = usePlugins();
  const hasProject = Boolean(selectedProject);
  const shouldShowTasks = !IS_CODEX_ONLY_HARDENED && Boolean(tasksEnabled && isTaskMasterInstalled);
  const enabledPlugins = useMemo(() => plugins.filter((item) => item.enabled), [plugins]);
  const activeSurfaceLabel = getActiveSurfaceLabel(activeTab);
  const projectLabel = selectedProject?.displayName || selectedProject?.name || 'No project selected';

  const workbenchActions: MoreAction[] = [
    {
      id: 'chat',
      label: 'Chat flow',
      hint: 'Return to the main mobile path for projects, recent threads, and active chat.',
      icon: MessageSquareText,
      onClick: onGoHome,
      badge: 'Primary',
    },
    {
      id: 'files',
      label: 'Files',
      hint: hasProject ? 'Browse the current project file tree and inspect source quickly.' : 'Pick a project first to unlock the file tree.',
      icon: Folder,
      tab: 'files',
      disabled: !hasProject,
      badge: hasProject ? 'Project' : 'Locked',
    },
    {
      id: 'shell',
      label: 'Shell',
      hint: hasProject ? 'Check terminal activity, recent commands, and live process output.' : 'Pick a project first to unlock Shell.',
      icon: Terminal,
      tab: 'shell',
      disabled: !hasProject,
      badge: hasProject ? 'Project' : 'Locked',
    },
    {
      id: 'git',
      label: 'Git',
      hint: hasProject ? 'Inspect branch state, diff activity, and repository changes.' : 'Pick a project first to unlock Git.',
      icon: GitBranch,
      tab: 'git',
      disabled: !hasProject,
      badge: hasProject ? 'Project' : 'Locked',
    },
  ];

  const pluginActions: MoreAction[] = [
    ...(shouldShowTasks
      ? [{
          id: 'tasks',
          label: 'Automation / Tasks',
          hint: hasProject ? 'Review task breakdowns, workflow helpers, and project automation.' : 'Pick a project first to unlock automation tools.',
          icon: ListChecks,
          tab: 'tasks' as AppTab,
          disabled: !hasProject,
          badge: hasProject ? 'Project' : 'Locked',
        }]
      : []),
    ...enabledPlugins.map((plugin) => ({
      id: plugin.name,
      label: plugin.displayName,
      hint: hasProject ? 'Open the plugin-provided extension view for this project.' : 'Pick a project first to unlock plugin views.',
      icon: Puzzle,
      tab: `plugin:${plugin.name}` as AppTab,
      disabled: !hasProject,
      badge: hasProject ? 'Plugin' : 'Locked',
    })),
  ];

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title="More"
      description="Keep the main mobile surface focused on chat, and move lower-frequency tools into a secondary workspace."
      footer={(
        <button
          type="button"
          onClick={() => {
            onClose();
            onShowSettings();
          }}
          className="mobile-card mobile-shadow flex w-full items-center gap-3 px-4 py-4 text-left transition-transform active:scale-[0.99]"
        >
          <div className="mobile-pill inline-flex h-11 w-11 items-center justify-center text-primary">
            <Settings className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium text-foreground">
              {t('actions.settings', { defaultValue: 'Settings' })}
            </div>
            <div className="mt-1 text-[13px] leading-5 mobile-muted-text">
              Adjust account, display, and device-specific mobile preferences.
            </div>
          </div>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        </button>
      )}
    >
      <div className="space-y-5">
        <section className="mobile-card mobile-shadow p-4">
          <div className="flex items-start gap-3">
            <div className="mobile-pill inline-flex h-11 w-11 flex-shrink-0 items-center justify-center text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium uppercase tracking-[0.12em] mobile-muted-text">
                Current context
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="mobile-pill px-3 py-1 text-[12px] font-medium text-foreground">
                  {activeSurfaceLabel}
                </span>
                <span className="mobile-pill px-3 py-1 text-[12px] font-medium text-foreground">
                  {hasProject ? 'Project ready' : 'Project needed'}
                </span>
              </div>
              <div className="mobile-clamp-2 mt-3 text-[15px] font-medium leading-6 text-foreground">
                {projectLabel}
              </div>
              <div className="mt-1 text-[13px] leading-5 mobile-muted-text">
                {hasProject
                  ? 'Project-specific tools below will stay aligned with this selected workspace.'
                  : 'Files, Shell, Git, and extensions stay hidden behind an explicit project selection.'}
              </div>
            </div>
          </div>
        </section>

        {!hasProject ? (
          <section className="mobile-card p-4">
            <div className="text-[13px] font-medium uppercase tracking-[0.12em] mobile-muted-text">
              Before you open tools
            </div>
            <div className="mt-2 text-[14px] leading-6 text-foreground">
              Go back to Projects, choose a workspace, then reopen More to unlock project-scoped tools.
            </div>
          </section>
        ) : null}

        <section>
          <div className="mb-3 text-[13px] font-medium uppercase tracking-[0.12em] mobile-muted-text">
            Workbench
          </div>
          <div className="space-y-3">
            {workbenchActions.map((action) => (
              <ActionRow
                key={action.id}
                label={action.label}
                hint={action.hint}
                badge={action.badge}
                icon={action.icon}
                active={Boolean(action.tab && activeTab === action.tab)}
                disabled={action.disabled}
                onClick={() => {
                  if (action.disabled) {
                    return;
                  }

                  onClose();
                  if (action.onClick) {
                    action.onClick();
                    return;
                  }
                  if (action.tab) {
                    onSelectTab(action.tab);
                  }
                }}
              />
            ))}
          </div>
        </section>

        {!IS_CODEX_ONLY_HARDENED && pluginActions.length > 0 ? (
          <section>
            <div className="mb-3 text-[13px] font-medium uppercase tracking-[0.12em] mobile-muted-text">
              Extensions
            </div>
            <div className="space-y-3">
              {pluginActions.map((action) => (
                <ActionRow
                  key={action.id}
                  label={action.label}
                  hint={action.hint}
                  badge={action.badge}
                  icon={action.icon}
                  active={Boolean(action.tab && activeTab === action.tab)}
                  disabled={action.disabled}
                  onClick={() => {
                    if (action.disabled || !action.tab) {
                      return;
                    }
                    onClose();
                    onSelectTab(action.tab);
                  }}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </MobileBottomSheet>
  );
}
