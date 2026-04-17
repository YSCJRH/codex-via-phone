import React from 'react';
import { useTranslation } from 'react-i18next';
import { IS_CODEX_ONLY_HARDENED } from '../../../../constants/config';
import type { PermissionMode, Provider } from '../../types/types';
import ThinkingModeSelector from './ThinkingModeSelector';
import TokenUsagePie from './TokenUsagePie';

interface ChatInputControlsProps {
  permissionMode: PermissionMode | string;
  onModeSwitch: () => void;
  provider: Provider | string;
  thinkingMode: string;
  setThinkingMode: React.Dispatch<React.SetStateAction<string>>;
  tokenBudget: { used?: number; total?: number } | null;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  isUserScrolledUp: boolean;
  hasMessages: boolean;
  onScrollToBottom: () => void;
  variant?: 'inline' | 'sheet';
}

export default function ChatInputControls({
  permissionMode,
  onModeSwitch,
  provider,
  thinkingMode,
  setThinkingMode,
  tokenBudget,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  isUserScrolledUp,
  hasMessages,
  onScrollToBottom,
  variant = 'inline',
}: ChatInputControlsProps) {
  const { t } = useTranslation('chat');
  const effectivePermissionMode =
    permissionMode === 'bypassPermissions' ? 'acceptEdits' : permissionMode;
  const contextTotal =
    tokenBudget?.total || parseInt(import.meta.env.VITE_CONTEXT_WINDOW) || 160000;
  const contextUsed = tokenBudget?.used || 0;
  const contextPercent = Math.min(
    100,
    Math.max(0, Math.round((contextUsed / Math.max(contextTotal, 1)) * 100))
  );
  const permissionLabel =
    effectivePermissionMode === 'default'
      ? t('codex.modes.default')
      : effectivePermissionMode === 'acceptEdits'
        ? t('codex.modes.acceptEdits')
        : t('codex.modes.plan');

  const permissionButton = (
    <button
      type="button"
      onClick={onModeSwitch}
      className={`rounded-lg border px-2.5 py-1 text-sm font-medium transition-all duration-200 sm:px-3 sm:py-1.5 ${
        effectivePermissionMode === 'default'
          ? 'border-border/60 bg-muted/50 text-muted-foreground hover:bg-muted'
          : effectivePermissionMode === 'acceptEdits'
            ? 'border-green-300/60 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-600/40 dark:bg-green-900/15 dark:text-green-300 dark:hover:bg-green-900/25'
            : 'border-primary/20 bg-primary/5 text-primary hover:bg-primary/10'
      }`}
      title={t('input.clickToChangeMode')}
    >
      <div className="flex items-center gap-1.5">
        <div
          className={`h-1.5 w-1.5 rounded-full ${
            effectivePermissionMode === 'default'
              ? 'bg-muted-foreground'
              : effectivePermissionMode === 'acceptEdits'
                ? 'bg-green-500'
                : 'bg-primary'
          }`}
        />
        <span>{permissionLabel}</span>
      </div>
    </button>
  );

  const inlineActions = (
    <>
      {!IS_CODEX_ONLY_HARDENED && (
        <button
          type="button"
          onClick={onToggleCommandMenu}
          className="relative flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground sm:h-8 sm:w-8"
          title={t('input.showAllCommands')}
        >
          <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
            />
          </svg>
          {slashCommandsCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground sm:h-5 sm:w-5">
              {slashCommandsCount}
            </span>
          )}
        </button>
      )}

      {hasInput && (
        <button
          type="button"
          onClick={onClearInput}
          className="group flex h-7 w-7 items-center justify-center rounded-lg border border-border/50 bg-card shadow-sm transition-all duration-200 hover:bg-accent/60 sm:h-8 sm:w-8"
          title={t('input.clearInput', { defaultValue: 'Clear input' })}
        >
          <svg
            className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground sm:h-4 sm:w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {isUserScrolledUp && hasMessages && (
        <button
          type="button"
          onClick={onScrollToBottom}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-all duration-200 hover:scale-105 hover:bg-primary/90 sm:h-8 sm:w-8"
          title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
        >
          <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}
    </>
  );

  if (variant === 'sheet') {
    return (
      <div className="space-y-3">
        <div className="rounded-[1.35rem] border border-border/50 bg-background/55 p-3.5">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] mobile-muted-text">
                Session mode
              </div>
              <div className="mt-1 text-[13px] leading-6 mobile-subtle-text">
                Choose how much freedom Codex has while working in this thread.
              </div>
            </div>
            <div className="mobile-pill px-2.5 py-1 text-[11px] font-medium text-primary">
              {permissionLabel}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {permissionButton}
          </div>
        </div>

        {provider === 'claude' && (
          <div className="rounded-[1.35rem] border border-border/50 bg-background/55 p-3.5">
            <div className="mb-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] mobile-muted-text">
                Reasoning
              </div>
              <div className="mt-1 text-[13px] leading-6 mobile-subtle-text">
                Adjust the model thinking depth for this conversation.
              </div>
            </div>
            <ThinkingModeSelector selectedMode={thinkingMode} onModeChange={setThinkingMode} onClose={() => {}} className="" />
          </div>
        )}

        <div className="rounded-[1.35rem] border border-border/50 bg-background/55 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] mobile-muted-text">
                Context window
              </div>
              <div className="mt-1 text-[13px] leading-6 mobile-subtle-text">
                {`${contextUsed.toLocaleString()} used of ${contextTotal.toLocaleString()} tokens`}
              </div>
            </div>
            <div className="mobile-pill mobile-tabular px-2.5 py-1 text-[11px] font-medium text-foreground">
              {contextPercent}%
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-[1.1rem] border border-border/40 bg-muted/35 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-foreground">Current model budget</div>
              <div className="mt-1 text-[12px] leading-5 mobile-muted-text">
                Keep an eye on remaining room before long replies and tool traces.
              </div>
            </div>
            <div className="flex-shrink-0">
              <TokenUsagePie used={contextUsed} total={contextTotal} />
            </div>
          </div>
        </div>

        {(hasInput || (isUserScrolledUp && hasMessages) || !IS_CODEX_ONLY_HARDENED) && (
          <div className="rounded-[1.35rem] border border-border/50 bg-background/55 p-3.5">
            <div className="mb-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] mobile-muted-text">
                Quick actions
              </div>
              <div className="mt-1 text-[13px] leading-6 mobile-subtle-text">
                Jump to recent output, open slash commands, or clear the current draft.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!IS_CODEX_ONLY_HARDENED && (
                <button
                  type="button"
                  onClick={onToggleCommandMenu}
                  className="mobile-pill relative inline-flex h-10 items-center justify-center gap-2 px-3.5 text-[13px] font-medium text-foreground"
                >
                  <svg className="h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                    />
                  </svg>
                  Commands
                  {slashCommandsCount > 0 && (
                    <span className="inline-flex min-w-[1.2rem] items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                      {slashCommandsCount}
                    </span>
                  )}
                </button>
              )}

              {hasInput && (
                <button
                  type="button"
                  onClick={onClearInput}
                  className="mobile-pill inline-flex h-10 items-center justify-center gap-2 px-3.5 text-[13px] font-medium text-foreground"
                >
                  <svg className="h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Clear draft
                </button>
              )}

              {isUserScrolledUp && hasMessages && (
                <button
                  type="button"
                  onClick={onScrollToBottom}
                  className="mobile-pill inline-flex h-10 items-center justify-center gap-2 px-3.5 text-[13px] font-medium text-primary"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  Jump to latest
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
      {permissionButton}

      {provider === 'claude' && (
        <ThinkingModeSelector selectedMode={thinkingMode} onModeChange={setThinkingMode} onClose={() => {}} className="" />
      )}

      <TokenUsagePie used={contextUsed} total={contextTotal} />

      {inlineActions}
    </div>
  );
}
