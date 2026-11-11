import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';

interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  side?: 'left' | 'right';
}

export function Drawer({ open, title, onClose, children, side = 'left' }: DrawerProps) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    panelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Cerrar panel"
        className="absolute inset-0 bg-black/60 animate-fade-in"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          'glass-panel-strong absolute bottom-0 top-0 flex w-[min(20rem,88vw)] flex-col rounded-none shadow-raised outline-none',
          side === 'left' ? 'left-0 animate-slide-in-right' : 'right-0 animate-slide-in-right'
        )}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <span className="text-sm font-semibold text-plw-ink">{title}</span>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar panel">
            <X size={18} aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}
