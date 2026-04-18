import React from "react";
import { Check, ChevronDown, Clock3, MessageSquareText, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import SessionProviderLogo from "../../../llm-logo-provider/SessionProviderLogo";
import { IS_CODEX_ONLY_HARDENED } from "../../../../constants/config";
import {
  CLAUDE_MODELS,
  CURSOR_MODELS,
  CODEX_MODELS,
  GEMINI_MODELS,
} from "../../../../../shared/modelConstants";
import type { ProjectSession, SessionProvider } from "../../../../types/app";
import { NextTaskBanner } from "../../../task-master";

type ProviderSelectionEmptyStateProps = {
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  setProvider: (next: SessionProvider) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  cursorModel: string;
  setCursorModel: (model: string) => void;
  codexModel: string;
  setCodexModel: (model: string) => void;
  geminiModel: string;
  setGeminiModel: (model: string) => void;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: React.Dispatch<React.SetStateAction<string>>;
};

type ProviderDef = {
  id: SessionProvider;
  name: string;
  infoKey: string;
  accent: string;
  ring: string;
  check: string;
};

const PROVIDERS: ProviderDef[] = [
  {
    id: "claude",
    name: "Claude Code",
    infoKey: "providerSelection.providerInfo.anthropic",
    accent: "border-primary",
    ring: "ring-primary/15",
    check: "bg-primary text-primary-foreground",
  },
  {
    id: "cursor",
    name: "Cursor",
    infoKey: "providerSelection.providerInfo.cursorEditor",
    accent: "border-violet-500 dark:border-violet-400",
    ring: "ring-violet-500/15",
    check: "bg-violet-500 text-white",
  },
  {
    id: "codex",
    name: "Codex",
    infoKey: "providerSelection.providerInfo.openai",
    accent: "border-emerald-600 dark:border-emerald-400",
    ring: "ring-emerald-600/15",
    check: "bg-emerald-600 dark:bg-emerald-500 text-white",
  },
  {
    id: "gemini",
    name: "Gemini",
    infoKey: "providerSelection.providerInfo.google",
    accent: "border-blue-500 dark:border-blue-400",
    ring: "ring-blue-500/15",
    check: "bg-blue-500 text-white",
  },
];

function getModelConfig(p: SessionProvider) {
  if (p === "claude") return CLAUDE_MODELS;
  if (p === "codex") return CODEX_MODELS;
  if (p === "gemini") return GEMINI_MODELS;
  return CURSOR_MODELS;
}

function getModelValue(
  p: SessionProvider,
  c: string,
  cu: string,
  co: string,
  g: string,
) {
  if (p === "claude") return c;
  if (p === "codex") return co;
  if (p === "gemini") return g;
  return cu;
}

function formatRelativeTime(value?: string | null) {
  if (!value) {
    return "just now";
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "just now";
  }

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp.getTime()) / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  if (diffMinutes < 24 * 60) return `${Math.round(diffMinutes / 60)} hr ago`;
  return `${Math.round(diffMinutes / (60 * 24))} d ago`;
}

function getReadyPrompt(
  provider: SessionProvider,
  claudeModel: string,
  cursorModel: string,
  codexModel: string,
  geminiModel: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  return {
    claude: t("providerSelection.readyPrompt.claude", {
      model: claudeModel,
    }),
    cursor: t("providerSelection.readyPrompt.cursor", {
      model: cursorModel,
    }),
    codex: t("providerSelection.readyPrompt.codex", {
      model: codexModel,
    }),
    gemini: t("providerSelection.readyPrompt.gemini", {
      model: geminiModel,
    }),
  }[provider];
}

export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  claudeModel,
  setClaudeModel,
  cursorModel,
  setCursorModel,
  codexModel,
  setCodexModel,
  geminiModel,
  setGeminiModel,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation("chat");
  const nextTaskPrompt = t("tasks.nextTaskPrompt", {
    defaultValue: "Start the next task",
  });

  const selectProvider = (next: SessionProvider) => {
    setProvider(next);
    localStorage.setItem("selected-provider", next);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleModelChange = (value: string) => {
    if (provider === "claude") {
      setClaudeModel(value);
      localStorage.setItem("claude-model", value);
    } else if (provider === "codex") {
      setCodexModel(value);
      localStorage.setItem("codex-model", value);
    } else if (provider === "gemini") {
      setGeminiModel(value);
      localStorage.setItem("gemini-model", value);
    } else {
      setCursorModel(value);
      localStorage.setItem("cursor-model", value);
    }
  };

  const modelConfig = getModelConfig(provider);
  const currentModel = getModelValue(
    provider,
    claudeModel,
    cursorModel,
    codexModel,
    geminiModel,
  );
  const readyPrompt = getReadyPrompt(
    provider,
    claudeModel,
    cursorModel,
    codexModel,
    geminiModel,
    t,
  );
  const activeProvider = PROVIDERS.find((item) => item.id === provider) || PROVIDERS[0];
  const sessionProvider = selectedSession?.__provider || provider;
  const sessionProviderLabel = String(sessionProvider || "claude").toUpperCase();
  const sessionTitle =
    selectedSession?.summary ||
    selectedSession?.name ||
    t("session.continue.title", { defaultValue: "Continue conversation" });
  const sessionActivityLabel = formatRelativeTime(
    selectedSession?.lastActivity || selectedSession?.createdAt || null,
  );

  if (!selectedSession && !currentSessionId) {
    if (IS_CODEX_ONLY_HARDENED) {
      return (
        <div className="flex h-full items-center justify-center px-4 py-6">
          <div className="mobile-card mobile-shadow w-full max-w-md overflow-hidden">
            <div className="bg-gradient-to-br from-emerald-500/14 to-sky-500/10 px-6 py-7 text-center">
              <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-3xl border border-white/30 bg-white/55 shadow-sm dark:border-white/10 dark:bg-white/5">
                <SessionProviderLogo provider="codex" className="h-8 w-8" />
              </div>
              <div className="mt-4 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
                Codex only
              </div>
              <h2 className="mt-4 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                {t("providerSelection.title")}
              </h2>
              <p className="mt-2 text-sm leading-6 mobile-subtle-text">
                {readyPrompt}
              </p>
            </div>

            <div className="px-6 py-5">
              <div className="rounded-2xl border border-border/45 bg-background/55 px-4 py-4">
                <div className="text-[13px] font-medium uppercase tracking-[0.12em] mobile-muted-text">
                  Model
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-foreground">
                    {t("providerSelection.selectModel")}
                  </span>
                  <div className="relative">
                    <select
                      value={codexModel}
                      onChange={(e) => {
                        setCodexModel(e.target.value);
                        localStorage.setItem("codex-model", e.target.value);
                      }}
                      className="cursor-pointer appearance-none rounded-lg border border-border/60 bg-muted/50 py-1.5 pl-3 pr-7 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      {CODEX_MODELS.OPTIONS.map(({ value, label }) => (
                        <option key={value + label} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
              </div>

              {tasksEnabled && isTaskMasterInstalled && (
                <div className="mt-5">
                  <NextTaskBanner
                    onStartTask={() => setInput(nextTaskPrompt)}
                    onShowAllTasks={onShowAllTasks}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full items-center justify-center px-4 py-6">
        <div className="mobile-card mobile-shadow w-full max-w-md overflow-hidden">
          <div className="bg-gradient-to-br from-primary/12 to-sky-500/10 px-6 py-7 text-center">
            <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-3xl border border-white/30 bg-white/55 shadow-sm dark:border-white/10 dark:bg-white/5">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <div className="mt-4 inline-flex rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
              New chat
            </div>
            <h2 className="mt-4 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {t("providerSelection.title")}
            </h2>
            <p className="mt-2 text-[13px] leading-6 mobile-subtle-text">
              {t("providerSelection.description")}
            </p>
          </div>

          <div className="px-6 py-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
              {PROVIDERS.map((item) => {
                const active = provider === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => selectProvider(item.id)}
                    className={`
                      relative flex flex-col items-center gap-2.5 rounded-xl border-[1.5px] px-2
                      pb-4 pt-5 text-center transition-all duration-150 active:scale-[0.97]
                      ${
                        active
                          ? `${item.accent} ${item.ring} bg-card shadow-sm ring-2`
                          : "border-border bg-card/60 hover:border-border/80 hover:bg-card"
                      }
                    `}
                  >
                    <SessionProviderLogo
                      provider={item.id}
                      className={`h-9 w-9 transition-transform duration-150 ${active ? "scale-110" : ""}`}
                    />
                    <div>
                      <p className="text-[13px] font-semibold leading-none text-foreground">
                        {item.name}
                      </p>
                      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
                        {t(item.infoKey)}
                      </p>
                    </div>
                    {active && (
                      <div
                        className={`absolute -right-1 -top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full ${item.check} shadow-sm`}
                      >
                        <Check className="h-2.5 w-2.5" strokeWidth={3} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-2xl border border-border/45 bg-background/55 px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="mobile-pill inline-flex h-11 w-11 flex-shrink-0 items-center justify-center text-primary">
                  <SessionProviderLogo provider={provider} className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[15px] font-medium text-foreground">
                      {activeProvider.name}
                    </div>
                    <span className="mobile-pill px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-foreground">
                      Selected
                    </span>
                  </div>
                  <div className="mt-1 text-[13px] leading-5 mobile-muted-text">
                    {readyPrompt}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">
                  {t("providerSelection.selectModel")}
                </span>
                <div className="relative">
                  <select
                    value={currentModel}
                    onChange={(e) => handleModelChange(e.target.value)}
                    tabIndex={-1}
                    className="cursor-pointer appearance-none rounded-lg border border-border/60 bg-muted/50 py-1.5 pl-3 pr-7 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {modelConfig.OPTIONS.map(
                      ({ value, label }: { value: string; label: string }) => (
                        <option key={value + label} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                </div>
              </div>
            </div>

            {tasksEnabled && isTaskMasterInstalled && (
              <div className="mt-5">
                <NextTaskBanner
                  onStartTask={() => setInput(nextTaskPrompt)}
                  onShowAllTasks={onShowAllTasks}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (selectedSession) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-6">
        <div className="mobile-card mobile-shadow w-full max-w-md overflow-hidden">
          <div className="bg-gradient-to-br from-primary/12 to-sky-500/10 px-6 py-7 text-center">
            <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-3xl border border-white/30 bg-white/55 shadow-sm dark:border-white/10 dark:bg-white/5">
              <MessageSquareText className="h-8 w-8 text-primary" />
            </div>
            <div className="mt-4 inline-flex rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
              Continue chat
            </div>
            <h2 className="mt-4 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {t("session.continue.title")}
            </h2>
            <p className="mt-2 text-sm leading-6 mobile-subtle-text">
              {t("session.continue.description")}
            </p>
          </div>

          <div className="px-6 py-5">
            <div className="rounded-2xl border border-border/45 bg-background/55 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[15px] font-medium text-foreground">
                  {sessionTitle}
                </div>
                <span className="mobile-pill px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-foreground">
                  {sessionProviderLabel}
                </span>
                {currentSessionId ? (
                  <span className="mobile-pill px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-primary">
                    Active
                  </span>
                ) : null}
              </div>
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-background/65 px-3 py-1 text-[11px] font-medium text-foreground">
                <Clock3 className="h-3.5 w-3.5 text-primary" />
                {sessionActivityLabel}
              </div>
            </div>

            {tasksEnabled && isTaskMasterInstalled && (
              <div className="mt-5">
                <NextTaskBanner
                  onStartTask={() => setInput(nextTaskPrompt)}
                  onShowAllTasks={onShowAllTasks}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
