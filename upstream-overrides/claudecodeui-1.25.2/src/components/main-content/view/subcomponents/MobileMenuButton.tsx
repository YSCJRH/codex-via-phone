import { Menu } from 'lucide-react';
import type { MobileMenuButtonProps } from '../../types/types';

export default function MobileMenuButton({
  onMenuClick,
  compact = false,
}: MobileMenuButtonProps) {
  return (
    <button
      type="button"
      onClick={onMenuClick}
      className={`mobile-pill inline-flex items-center justify-center text-foreground transition-colors hover:text-primary ${
        compact ? 'h-11 w-11' : 'h-12 w-12'
      }`}
      aria-label="Open navigation"
    >
      <Menu className={compact ? 'h-5 w-5' : 'h-5.5 w-5.5'} />
    </button>
  );
}
