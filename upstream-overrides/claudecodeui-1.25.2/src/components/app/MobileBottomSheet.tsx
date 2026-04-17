import type { ReactNode } from 'react';
import { X } from 'lucide-react';

type MobileBottomSheetProps = {
  open: boolean;
  title: string;
  description?: string | null;
  children: ReactNode;
  onClose: () => void;
  contentClassName?: string;
  footer?: ReactNode;
};

export default function MobileBottomSheet({
  open,
  title,
  description = null,
  children,
  onClose,
  contentClassName = '',
  footer = null,
}: MobileBottomSheetProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[85] sm:hidden">
      <button
        type="button"
        className="mobile-sheet-backdrop absolute inset-0"
        aria-label="Close mobile sheet"
        onClick={onClose}
      />

      <div className="absolute inset-x-0 bottom-0">
        <div className="mobile-sheet-panel mx-0 overflow-hidden">
          <div className="mobile-safe-bottom px-4 pt-3">
            <div className="mx-auto mb-3 mobile-sheet-handle" />

            <div className="flex items-start justify-between gap-3 pb-3">
              <div className="min-w-0">
                <h2 className="mobile-clamp-1 text-lg font-semibold tracking-tight text-foreground">
                  {title}
                </h2>
                {description ? (
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {description}
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                className="mobile-pill inline-flex h-10 w-10 flex-shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Close"
                onClick={onClose}
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className={`max-h-[68vh] overflow-y-auto pb-2 ${contentClassName}`.trim()}>
              {children}
            </div>

            {footer ? (
              <>
                <div className="mobile-divider mt-2" />
                <div className="pb-1 pt-3">{footer}</div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
