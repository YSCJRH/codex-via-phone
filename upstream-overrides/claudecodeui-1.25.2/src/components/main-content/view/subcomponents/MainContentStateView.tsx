import {
  Folder,
  FolderSearch,
  LoaderCircle,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IS_CODEX_ONLY_HARDENED } from '../../../../constants/config';
import type { MainContentStateViewProps } from '../../types/types';
import MobileMenuButton from './MobileMenuButton';

type StateMode = 'loading' | 'empty' | 'not_found';

function getStateConfig(
  mode: StateMode,
  unresolvedSessionId: string | null,
  isMobile: boolean,
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (mode === 'loading') {
    return {
      headerTitle: 'Loading workspace',
      headerSubtitle: 'Syncing project and session state',
      badge: 'Loading',
      title: t('mainContent.loading'),
      description: t('mainContent.settingUpWorkspace'),
      tip: 'We are refreshing the latest project and thread context so mobile and desktop stay aligned.',
      actionLabel: null,
      icon: LoaderCircle,
      accent: 'from-sky-500/14 to-cyan-500/10',
      tone: 'border-sky-200/70 bg-sky-50/80 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/25 dark:text-sky-200',
    };
  }

  if (mode === 'not_found') {
    return {
      headerTitle: 'Session unavailable',
      headerSubtitle: 'Open another thread from Projects',
      badge: 'Missing',
      title: 'Session unavailable',
      description: `The requested session${unresolvedSessionId ? ` (${unresolvedSessionId})` : ''} could not be resolved. Refresh the project list or return to Projects and pick another thread.`,
      tip: 'If this happened right after the phone reconnected, give sync a moment to finish and then reopen the session from the project list.',
      actionLabel: 'Open projects',
      icon: FolderSearch,
      accent: 'from-amber-500/16 to-orange-500/10',
      tone: 'border-amber-200/70 bg-amber-50/80 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200',
    };
  }

  return {
    headerTitle: 'Projects',
    headerSubtitle: 'Choose a workspace to continue',
    badge: 'Ready',
    title: t('mainContent.chooseProject'),
    description: t('mainContent.selectProjectDescription'),
    tip: IS_CODEX_ONLY_HARDENED
      ? 'Select one of your existing Codex projects from the list to continue on mobile.'
      : isMobile
        ? t('mainContent.createProjectMobile')
        : t('mainContent.createProjectDesktop'),
    actionLabel: 'Open projects',
    icon: Folder,
    accent: 'from-violet-500/14 to-sky-500/10',
    tone: 'border-primary/15 bg-primary/6 text-primary',
  };
}

export default function MainContentStateView({
  mode,
  isMobile,
  onMenuClick,
  topWidget,
  unresolvedSessionId,
}: MainContentStateViewProps) {
  const { t } = useTranslation();

  const stateConfig = getStateConfig(mode, unresolvedSessionId, isMobile, t);
  const Icon = stateConfig.icon;
  const isLoading = mode === 'loading';

  return (
    <div className={`flex h-full flex-col ${isMobile ? 'mobile-shell' : ''}`}>
      {isMobile && (
        <div className="mobile-safe-top mobile-surface flex-shrink-0 border-x-0 border-t-0 px-4 pb-3 pt-2">
          <div className="flex items-center justify-between gap-3">
            <MobileMenuButton onMenuClick={onMenuClick} compact />

            <div className="min-w-0 flex-1 text-center">
              <div className="mobile-clamp-1 text-sm font-medium text-foreground">
                {stateConfig.headerTitle}
              </div>
              <div className="mobile-clamp-1 mt-1 text-[12px] mobile-muted-text">
                {stateConfig.headerSubtitle}
              </div>
            </div>

            <div className="inline-flex h-11 min-w-[3.25rem] items-center justify-center rounded-full bg-background/55 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
              {stateConfig.badge}
            </div>
          </div>
        </div>
      )}

      {topWidget ? (
        <div className={`flex-shrink-0 ${isMobile ? 'px-4 pt-4' : 'border-b border-border/50 bg-background/80 backdrop-blur-sm'}`}>
          <div className={`${isMobile ? 'mobile-card mobile-shadow max-h-[42vh] overflow-y-auto p-4' : 'max-h-[42vh] overflow-y-auto p-3 sm:p-4'}`}>
            {topWidget}
          </div>
        </div>
      ) : null}

      <div className="flex flex-1 items-center justify-center px-4 py-6 sm:px-6">
        <div className={`mx-auto w-full ${isMobile ? 'max-w-lg' : 'max-w-md'}`}>
          <div className={`${isMobile ? 'mobile-card mobile-shadow' : 'rounded-3xl border border-border/50 bg-background/85 shadow-sm'} overflow-hidden`}>
            <div className={`bg-gradient-to-br ${stateConfig.accent} px-6 py-7`}>
              <div className="flex items-start gap-4">
                <div className={`inline-flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-3xl border border-white/30 bg-white/55 shadow-sm dark:border-white/10 dark:bg-white/5`}>
                  <Icon className={`h-8 w-8 ${isLoading ? 'animate-spin text-primary' : 'text-foreground'}`} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${stateConfig.tone}`}>
                    {stateConfig.badge}
                  </div>
                  <h2 className="mt-3 text-xl font-semibold tracking-tight text-foreground">
                    {stateConfig.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 mobile-subtle-text">
                    {stateConfig.description}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 py-5">
              <div className="rounded-2xl border border-border/45 bg-background/55 px-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="mobile-pill inline-flex h-10 w-10 flex-shrink-0 items-center justify-center text-primary">
                    <Sparkles className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium uppercase tracking-[0.12em] mobile-muted-text">
                      Next step
                    </div>
                    <div className="mt-2 text-[14px] leading-6 text-foreground">
                      {stateConfig.tip}
                    </div>
                  </div>
                </div>
              </div>

              {stateConfig.actionLabel ? (
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={onMenuClick}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Folder className="h-4 w-4" />
                    {stateConfig.actionLabel}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
