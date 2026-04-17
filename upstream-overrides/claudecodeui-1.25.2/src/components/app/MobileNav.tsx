import { FolderOpen, MessageSquareText, Sparkles, type LucideIcon } from 'lucide-react';

type MobileNavItem = 'projects' | 'chat' | 'more';

type MobileNavProps = {
  activeItem: MobileNavItem;
  onProjectsClick: () => void;
  onChatClick: () => void;
  onMoreClick: () => void;
  isInputFocused: boolean;
};

type ItemConfig = {
  id: MobileNavItem;
  label: string;
  icon: LucideIcon;
};

const ITEMS: ItemConfig[] = [
  { id: 'projects', label: 'Projects', icon: FolderOpen },
  { id: 'chat', label: 'Chat', icon: MessageSquareText },
  { id: 'more', label: 'More', icon: Sparkles },
];

export default function MobileNav({
  activeItem,
  onProjectsClick,
  onChatClick,
  onMoreClick,
  isInputFocused,
}: MobileNavProps) {
  const handlers: Record<MobileNavItem, () => void> = {
    projects: onProjectsClick,
    chat: onChatClick,
    more: onMoreClick,
  };

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-[70] px-4 pb-[max(12px,env(safe-area-inset-bottom))] transition-transform duration-300 ease-out sm:hidden ${
        isInputFocused ? 'translate-y-full' : 'translate-y-0'
      }`}
    >
      <div className="mobile-surface mobile-shadow rounded-[28px] px-2.5 py-2">
        <div className="grid grid-cols-3 gap-2">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeItem === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className={`relative flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[22px] px-3 py-2.5 transition-all duration-200 active:scale-[0.98] ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`}
                onClick={handlers[item.id]}
              >
                {isActive ? (
                  <div className="absolute inset-0 rounded-[22px] bg-primary/10 dark:bg-primary/15" />
                ) : null}

                <Icon
                  className={`relative z-10 ${isActive ? 'h-5.5 w-5.5' : 'h-5 w-5'}`}
                  strokeWidth={isActive ? 2.3 : 1.9}
                />
                <span className="relative z-10 text-[11px] font-medium tracking-[0.02em]">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
