import {
  ChevronLeft,
  Ellipsis,
  Folder,
  GitBranch,
  ListChecks,
  Menu,
  MessageSquareText,
  Puzzle,
  Terminal,
} from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MainContentHeaderProps } from '../../types/types';
import MainContentTabSwitcher from './MainContentTabSwitcher';

const MOBILE_TAB_META: Record<string, { label: string; icon: typeof MessageSquareText }> = {
  chat: { label: 'Chat', icon: MessageSquareText },
  files: { label: 'Files', icon: Folder },
  shell: { label: 'Shell', icon: Terminal },
  git: { label: 'Git', icon: GitBranch },
  tasks: { label: 'Automation', icon: ListChecks },
};

export default function MainContentHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  isMobile,
  onMenuClick,
  onMobileSheetChange,
}: MainContentHeaderProps) {
  const navigate = useNavigate();

  const mobileMeta = useMemo(() => {
    if (activeTab.startsWith('plugin:')) {
      return {
        label: activeTab.replace('plugin:', ''),
        icon: Puzzle,
      };
    }

    return MOBILE_TAB_META[activeTab] || MOBILE_TAB_META.chat;
  }, [activeTab]);

  const mobileTitle = selectedSession?.summary
    || selectedSession?.name
    || selectedProject.displayName
    || selectedProject.name;
  const mobileSubtitle = activeTab === 'chat'
    ? (selectedProject.displayName || selectedProject.name)
    : `${mobileMeta.label} / ${selectedProject.displayName || selectedProject.name}`;

  const handleBack = () => {
    if (activeTab !== 'chat') {
      setActiveTab('chat');
      if (selectedSession?.id) {
        navigate(`/session/${selectedSession.id}`);
      } else {
        navigate('/');
      }
      return;
    }

    navigate('/');
  };

  if (isMobile) {
    const backLabel = activeTab === 'chat' ? 'Back to projects' : 'Back to chat';

    return (
      <header className="mobile-safe-top mobile-surface sticky top-0 z-30 border-x-0 border-t-0 px-4 pb-3 pt-2">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={activeTab === 'chat' && !selectedSession ? onMenuClick : handleBack}
            className="mobile-pill inline-flex h-12 w-12 flex-shrink-0 items-center justify-center text-foreground transition-colors hover:text-primary"
            aria-label={activeTab === 'chat' && !selectedSession ? 'Open navigation' : backLabel}
          >
            {activeTab === 'chat' && !selectedSession ? (
              <Menu className="h-5 w-5" />
            ) : (
              <ChevronLeft className="h-5 w-5" />
            )}
          </button>

          <div className="min-w-0 flex-1 text-center">
            <div className="mobile-clamp-1 text-[17px] font-semibold tracking-tight text-foreground">
              {mobileTitle}
            </div>
            <div className="mobile-clamp-1 mt-1 text-[12px] mobile-muted-text">
              {mobileSubtitle}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onMobileSheetChange?.('more')}
            className="mobile-pill inline-flex h-12 w-12 flex-shrink-0 items-center justify-center text-foreground transition-colors hover:text-primary"
            aria-label="Open more actions"
          >
            <Ellipsis className="h-5 w-5" />
          </button>
        </div>
      </header>
    );
  }

  return (
    <header className="border-b border-border/50 bg-background/85 px-4 py-3 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight text-foreground">
            {selectedSession?.summary || selectedSession?.name || selectedProject.displayName || selectedProject.name}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {selectedProject.displayName || selectedProject.name}
          </div>
        </div>

        <MainContentTabSwitcher
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          shouldShowTasksTab={shouldShowTasksTab}
        />
      </div>
    </header>
  );
}
