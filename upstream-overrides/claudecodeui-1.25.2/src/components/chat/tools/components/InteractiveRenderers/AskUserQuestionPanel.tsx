import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PermissionPanelProps } from '../../configs/permissionPanelRegistry';
import type { Question } from '../../../types/types';

export const AskUserQuestionPanel: React.FC<PermissionPanelProps> = ({
  request,
  onDecision,
}) => {
  const input = request.input as { questions?: Question[] } | undefined;
  const questions: Question[] = input?.questions || [];

  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map());
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(() => new Map());
  const [otherActive, setOtherActive] = useState<Map<number, boolean>>(() => new Map());
  const [mounted, setMounted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  useEffect(() => {
    if (!otherActive.get(currentStep)) {
      containerRef.current?.focus();
    }
  }, [currentStep, otherActive]);

  useEffect(() => {
    if (otherActive.get(currentStep)) {
      otherInputRef.current?.focus();
    }
  }, [otherActive, currentStep]);

  const toggleOption = useCallback((qIdx: number, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(qIdx) || []);

      if (multiSelect) {
        if (current.has(label)) {
          current.delete(label);
        } else {
          current.add(label);
        }
      } else {
        current.clear();
        current.add(label);
        setOtherActive((previous) => {
          const nextState = new Map(previous);
          nextState.set(qIdx, false);
          return nextState;
        });
      }

      next.set(qIdx, current);
      return next;
    });
  }, []);

  const toggleOther = useCallback((qIdx: number, multiSelect: boolean) => {
    setOtherActive((prev) => {
      const next = new Map(prev);
      const wasActive = next.get(qIdx) || false;
      next.set(qIdx, !wasActive);

      if (!multiSelect && !wasActive) {
        setSelections((previous) => {
          const nextSelections = new Map(previous);
          nextSelections.set(qIdx, new Set());
          return nextSelections;
        });
      }

      return next;
    });
  }, []);

  const setOtherText = useCallback((qIdx: number, text: string) => {
    setOtherTexts((prev) => {
      const next = new Map(prev);
      next.set(qIdx, text);
      return next;
    });
  }, []);

  const buildAnswers = useCallback(() => {
    const answers: Record<string, string> = {};

    questions.forEach((question, index) => {
      const selected = Array.from(selections.get(index) || []);
      const isOther = otherActive.get(index) || false;
      const otherText = (otherTexts.get(index) || '').trim();

      if (isOther && otherText) {
        selected.push(otherText);
      }

      if (selected.length > 0) {
        answers[question.question] = selected.join(', ');
      }
    });

    return answers;
  }, [questions, selections, otherActive, otherTexts]);

  const handleSubmit = useCallback(() => {
    onDecision(request.requestId, {
      allow: true,
      updatedInput: { ...input, answers: buildAnswers() },
    });
  }, [onDecision, request.requestId, input, buildAnswers]);

  const handleSkip = useCallback(() => {
    onDecision(request.requestId, {
      allow: true,
      updatedInput: { ...input, answers: {} },
    });
  }, [onDecision, request.requestId, input]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) {
      return;
    }

    const question = questions[currentStep];
    if (!question) {
      return;
    }

    const multiSelect = question.multiSelect || false;
    const optionCount = question.options.length;
    const keyAsNumber = Number.parseInt(event.key, 10);

    if (!Number.isNaN(keyAsNumber) && keyAsNumber >= 1 && keyAsNumber <= optionCount) {
      event.preventDefault();
      toggleOption(currentStep, question.options[keyAsNumber - 1].label, multiSelect);
      return;
    }

    if (event.key === '0') {
      event.preventDefault();
      toggleOther(currentStep, multiSelect);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const isLastQuestion = currentStep === questions.length - 1;

      if (isLastQuestion) {
        handleSubmit();
      } else {
        setCurrentStep((step) => step + 1);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      handleSkip();
    }
  }, [currentStep, questions, toggleOption, toggleOther, handleSubmit, handleSkip]);

  if (questions.length === 0) {
    return null;
  }

  const total = questions.length;
  const isSingle = total === 1;
  const question = questions[currentStep];
  const multiSelect = question.multiSelect || false;
  const selected = selections.get(currentStep) || new Set<string>();
  const isOtherActive = otherActive.get(currentStep) || false;
  const isLast = currentStep === total - 1;
  const isFirst = currentStep === 0;
  const hasCurrentSelection =
    selected.size > 0 ||
    (isOtherActive && (otherTexts.get(currentStep) || '').trim().length > 0);
  const optionButtonClass = (active: boolean, dashed = false) =>
    `group flex w-full items-center gap-2.5 rounded-[1.15rem] border px-3 py-2.5 text-left transition-all duration-150 ${
      active
        ? 'border-primary/30 bg-primary/10 ring-1 ring-primary/15'
        : `${dashed ? 'border-dashed ' : ''}border-border/55 bg-background/55 hover:border-border hover:bg-muted/45`
    }`;
  const optionKeyClass = (active: boolean) =>
    `flex h-5 w-5 flex-shrink-0 items-center justify-center rounded font-mono text-[10px] transition-all duration-150 ${
      active
        ? 'bg-primary font-semibold text-primary-foreground'
        : 'border border-border/50 bg-muted/45 text-muted-foreground'
    }`;
  const secondaryButtonClass =
    'inline-flex items-center gap-1 rounded-xl border border-border/60 px-3 py-1.5 text-[11px] font-medium text-foreground transition-all duration-150 hover:bg-muted/50';
  const primaryButtonClass =
    'inline-flex items-center gap-1 rounded-xl bg-primary px-3.5 py-1.5 text-[11px] font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:bg-primary/90';

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={`w-full outline-none transition-all duration-500 ease-out ${
        mounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      }`}
    >
      <div className="mobile-card mobile-shadow relative overflow-hidden">
        <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-blue-500 via-cyan-400 to-teal-400" />

        <div className="px-4 pb-2 pt-3.5">
          <div className="mb-1.5 flex items-center gap-2.5">
            <div className="relative flex-shrink-0">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/10 to-cyan-500/10 dark:from-blue-400/15 dark:to-cyan-400/15">
                <svg
                  className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.75}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827m0 3h.01"
                  />
                </svg>
              </div>
              <div className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-cyan-400 dark:bg-cyan-500" />
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Input required
              </span>
              {question.header && (
                <span className="mobile-pill inline-flex items-center px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-primary">
                  {question.header}
                </span>
              )}
            </div>

            {!isSingle && (
              <span className="mobile-tabular flex-shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
                {currentStep + 1}/{total}
              </span>
            )}
          </div>

          {!isSingle && (
            <div className="mb-2 flex items-center gap-1">
              {questions.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setCurrentStep(index)}
                  className={`h-[3px] rounded-full transition-all duration-300 ${
                    index === currentStep
                      ? 'w-5 bg-blue-500 dark:bg-blue-400'
                      : index < currentStep
                        ? 'w-2.5 bg-blue-300 dark:bg-blue-600'
                        : 'w-2.5 bg-gray-200 dark:bg-gray-700'
                  }`}
                />
              ))}
            </div>
          )}

          <p className="text-[14px] font-medium leading-snug text-gray-900 dark:text-gray-100">
            {question.question}
          </p>
          {multiSelect && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              Select all that apply
            </span>
          )}
        </div>

        <div
          className="scrollbar-thin max-h-48 overflow-y-auto px-4 pb-2"
          role={multiSelect ? 'group' : 'radiogroup'}
          aria-label={question.question}
        >
          <div className="space-y-1.5">
            {question.options.map((option, optionIndex) => {
              const isSelected = selected.has(option.label);

              return (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => toggleOption(currentStep, option.label, multiSelect)}
                  aria-pressed={isSelected}
                  className={optionButtonClass(isSelected)}
                >
                  <kbd className={optionKeyClass(isSelected)}>
                    {optionIndex + 1}
                  </kbd>

                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-[13px] leading-tight transition-colors duration-150 ${
                        isSelected
                          ? 'font-medium text-gray-900 dark:text-gray-100'
                          : 'text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {option.label}
                    </div>
                    {option.description && (
                      <div
                        className={`text-[11px] leading-snug transition-colors duration-150 ${
                          isSelected
                            ? 'text-blue-600/70 dark:text-blue-300/70'
                            : 'text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        {option.description}
                      </div>
                    )}
                  </div>

                  {isSelected && (
                    <svg
                      className="h-4 w-4 flex-shrink-0 text-blue-500 dark:text-blue-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => toggleOther(currentStep, multiSelect)}
              aria-pressed={isOtherActive}
              className={optionButtonClass(isOtherActive, true)}
            >
              <kbd className={optionKeyClass(isOtherActive)}>
                0
              </kbd>
              <span
                className={`text-[13px] leading-tight transition-colors ${
                  isOtherActive
                    ? 'font-medium text-gray-900 dark:text-gray-100'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                Other...
              </span>
              {isOtherActive && (
                <svg
                  className="ml-auto h-4 w-4 flex-shrink-0 text-blue-500 dark:text-blue-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
            </button>

            {isOtherActive && (
              <div className="pl-[30px] pr-0.5">
                <div className="relative">
                  <input
                    ref={otherInputRef}
                    type="text"
                    value={otherTexts.get(currentStep) || ''}
                    onChange={(event) => setOtherText(currentStep, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        if (isLast) {
                          handleSubmit();
                        } else {
                          setCurrentStep((step) => step + 1);
                        }
                      }
                      event.stopPropagation();
                    }}
                    placeholder="Type your answer..."
                    className="w-full rounded-xl border border-border/50 bg-muted/35 px-3 py-2 text-[13px] text-foreground outline-none transition-shadow duration-200 placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/20"
                  />
                  <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border/50 bg-background px-1 py-0.5 font-mono text-[9px] text-muted-foreground">
                    Enter
                  </kbd>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/40 bg-background/70 px-4 py-2">
          <button
            type="button"
            onClick={handleSkip}
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {isSingle ? 'Skip' : 'Skip all'}
            <span className="ml-1 text-[9px] text-muted-foreground/60">Esc</span>
          </button>

          <div className="flex items-center gap-1.5">
            {!isSingle && !isFirst && (
              <button
                type="button"
                onClick={() => setCurrentStep((step) => step - 1)}
                className={secondaryButtonClass}
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            )}

            {isLast ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!hasCurrentSelection && !Object.keys(buildAnswers()).length}
                className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none`}
              >
                Submit
                <span className="ml-0.5 font-mono text-[9px] opacity-70">Enter</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCurrentStep((step) => step + 1)}
                className={primaryButtonClass}
              >
                Next
                <span className="ml-0.5 font-mono text-[9px] opacity-70">Enter</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
