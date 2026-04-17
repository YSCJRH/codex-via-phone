import {
  Folder,
  GitBranch,
  ListChecks,
  MessageSquareText,
  Puzzle,
  Settings,
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
};

function ActionRow({
  label,
  hint,
  icon: Icon,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  hint: string;
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
      className={`mobile-card flex w-full items-center gap-3 px-4 py-4 text-left transition-all ${
        disabled ? 'cursor-not-allowed opacity-45' : 'active:scale-[0.99]'
      } ${active ? 'ring-1 ring-primary/25' : ''}`}
    >
      <div className="mobile-pill inline-flex h-11 w-11 flex-shrink-0 items-center justify-center text-primary">
        <Icon className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mobile-clamp-1 text-[15px] font-medium text-foreground">{label}</div>
        <div className="mobile-clamp-2 mt-1 text-[13px] leading-5 mobile-muted-text">{hint}</div>
      </div>

      {active ? (
        <div className="rounded-full bg-primary/12 px-2.5 py-1 text-[11px] font-medium text-primary">
          Current
        </div>
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

  const workbenchActions: MoreAction[] = [
    {
      id: 'chat',
      label: 'Chat flow',
      hint: 'Return to the latest chat or the projects home screen.',
      icon: MessageSquareText,
      onClick: onGoHome,
    },
    {
      id: 'files',
      label: 'Files',
      hint: hasProject ? 'Browse the current project file tree.' : 'Select a project before opening the file tree.',
      icon: Folder,
      tab: 'files',
      disabled: !hasProject,
    },
    {
      id: 'shell',
      label: 'Shell',
      hint: hasProject ? 'Inspect terminal output and command activity.' : 'Select a project before opening Shell.',
      icon: Terminal,
      tab: 'shell',
      disabled: !hasProject,
    },
    {
      id: 'git',
      label: 'Git',
      hint: hasProject ? 'Inspect repository changes and version state.' : 'Select a project before opening Git.',
      icon: GitBranch,
      tab: 'git',
      disabled: !hasProject,
    },
  ];

  const pluginActions: MoreAction[] = [
    ...(shouldShowTasks
      ? [{
          id: 'tasks',
          label: 'Automation / Tasks',
          hint: hasProject ? 'Inspect task breakdowns, automation, and workflow helpers.' : 'Select a project before opening automation tools.',
          icon: ListChecks,
          tab: 'tasks' as AppTab,
          disabled: !hasProject,
        }]
      : []),
    ...enabledPlugins.map((plugin) => ({
      id: plugin.name,
      label: plugin.displayName,
      hint: 'Open the plugin-provided extension view.',
      icon: Puzzle,
      tab: `plugin:${plugin.name}` as AppTab,
      disabled: !hasProject,
    })),
  ];

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title="More"
      description="Keep the mobile surface focused on projects and chat, and move lower-frequency tools into a secondary sheet."
      footer={(
        <button
          type="button"
          onClick={() => {
            onClose();
            onShowSettings();
          }}
          className="mobile-card flex w-full items-center gap-3 px-4 py-4 text-left transition-transform active:scale-[0.99]"
        >
          <div className="mobile-pill inline-flex h-11 w-11 items-center justify-center text-primary">
            <Settings className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium text-foreground">{t('actions.settings', { defaultValue: 'Settings' })}</div>
            <div className="mt-1 text-[13px] leading-5 mobile-muted-text">
              Adjust account, display, and device-specific mobile preferences.
            </div>
          </div>
        </button>
      )}
    >
      <div className="space-y-5">
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
