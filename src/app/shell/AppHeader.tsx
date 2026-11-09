import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/features/auth/context/useAuth';
import { DemoModeBadge } from '@/components/ui/DemoModeBadge';

interface AppHeaderProps {
  displayName: string;
  roleLabel: string;
  statusControl: ReactNode;
}

export function AppHeader({ displayName, roleLabel, statusControl }: AppHeaderProps) {
  const { signOut } = useAuth();

  return (
    <header className="bg-plw-deep text-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <p className="truncate font-serif text-lg font-semibold tracking-wide text-white">
            PLW Call Center
          </p>
          <DemoModeBadge />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          {statusControl}
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-white">{displayName}</p>
            <p className="text-xs text-white/70">{roleLabel}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold-soft"
          >
            <LogOut size={16} aria-hidden="true" />
            Salir
          </button>
        </div>
      </div>
    </header>
  );
}
