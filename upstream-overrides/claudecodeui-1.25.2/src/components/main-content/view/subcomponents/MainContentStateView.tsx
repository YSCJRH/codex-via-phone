import { Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IS_CODEX_ONLY_HARDENED } from '../../../../constants/config';
import type { MainContentStateViewProps } from '../../types/types';
import MobileMenuButton from './MobileMenuButton';

export default function MainContentStateView({
  mode,
  isMobile,
  onMenuClick,
  topWidget,
  unresolvedSessionId,
}: MainContentStateViewProps) {
  const { t } = useTranslation();

  const isLoading = mode === 'loading';
  const isNotFound = mode === 'not_found';

  return (
    <div className={`flex h-full flex-col ${isMobile ? 'mobile-shell' : ''}`}>
      {isMobile && (
        <div className="mobile-safe-top mobile-surface flex-shrink-0 border-x-0 border-t-0 px-4 pb-3 pt-2">
          <div className="flex items-center justify-between gap-3">
            <MobileMenuButton onMenuClick={onMenuClick} compact />
            <div className="text-sm font-medium text-foreground">
              {isLoading ? 'Loading workspace' : isNotFound ? 'Session unavailable' : 'Projects'}
            </div>
            <div className="h-11 w-11" aria-hidden="true" />
          </div>
        </div>
      )}

      {topWidget ? (
        <div className="flex-shrink-0 border-b border-border/50 bg-background/80 backdrop-blur-sm">
          <div className="max-h-[42vh] overflow-y-auto p-3 sm:p-4">
            {topWidget}
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className={`text-center text-muted-foreground ${isMobile ? 'mobile-card mobile-shadow px-8 py-10' : ''}`}>
            <div className="mx-auto mb-4 h-10 w-10">
              <div
                className="h-full w-full rounded-full border-[3px] border-muted border-t-primary"
                style={{
                  animation: 'spin 1s linear infinite',
                  WebkitAnimation: 'spin 1s linear infinite',
                  MozAnimation: 'spin 1s linear infinite',
                }}
              />
            </div>
            <h2 className="mb-1 text-lg font-semibold text-foreground">{t('mainContent.loading')}</h2>
            <p className="text-sm">{t('mainContent.settingUpWorkspace')}</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className={`mx-auto max-w-md px-6 text-center ${isMobile ? 'mobile-card mobile-shadow py-8' : ''}`}>
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
              <Folder className="h-7 w-7 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-foreground">
              {isNotFound ? 'Session unavailable' : t('mainContent.chooseProject')}
            </h2>
            <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
              {isNotFound
                ? `The requested session${unresolvedSessionId ? ` (${unresolvedSessionId})` : ''} could not be resolved. Refresh the project list or return to the sidebar and pick another session.`
                : t('mainContent.selectProjectDescription')}
            </p>
            <div className="rounded-xl border border-primary/10 bg-primary/5 p-3.5">
              <p className="text-sm text-primary">
                <strong>{t('mainContent.tip')}:</strong>{' '}
                {isNotFound
                  ? 'If this happened after the phone reconnected, wait a moment for sync to complete and then open the session again from the sidebar.'
                  : IS_CODEX_ONLY_HARDENED
                    ? 'Select one of your existing Codex projects from the sidebar to continue.'
                    : isMobile
                      ? t('mainContent.createProjectMobile')
                      : t('mainContent.createProjectDesktop')}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
