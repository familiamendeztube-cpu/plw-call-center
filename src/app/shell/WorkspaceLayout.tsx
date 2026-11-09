import { useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/useAuth';
import { AgentStatusControl } from '@/features/presence/components/AgentStatusControl';
import { PhonePanel } from '@/features/telephony/components/PhonePanel';
import { PhoneBar } from '@/features/telephony/components/PhoneBar';
import { Drawer } from '@/components/ui/Drawer';
import { AppHeader } from '@/app/shell/AppHeader';
import { WorkspaceNav } from '@/app/shell/WorkspaceNav';
import { ADMIN_NAV_ITEMS, AGENT_NAV_ITEMS } from '@/app/shell/navigation';

export function WorkspaceLayout() {
  const { session } = useAuth();
  const [phoneOpen, setPhoneOpen] = useState(false);
  const closePhone = useCallback(() => setPhoneOpen(false), []);
  const openPhone = useCallback(() => setPhoneOpen(true), []);

  const isAgent = session?.role === 'agent';
  const navItems = isAgent ? AGENT_NAV_ITEMS : ADMIN_NAV_ITEMS;

  // Agents keep the phone on screen at every window size: the full phone beside the page on
  // wide windows, a dialer pinned to the top on narrow ones (a laptop split between windows).
  // Administrators never place calls, and their phone line never connects.
  return (
    <div className="flex min-h-dvh bg-plw-ivory">
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          displayName={session?.displayName ?? ''}
          roleLabel={isAgent ? 'Agente de ventas' : 'Administrador'}
          statusControl={isAgent ? <AgentStatusControl /> : null}
        />
        <WorkspaceNav
          items={navItems}
          label={isAgent ? 'Área de agente' : 'Área de administración'}
        />
        {isAgent ? (
          <div className="sticky top-0 z-30 xl:hidden">
            <PhoneBar onOpenPhone={openPhone} />
          </div>
        ) : null}
        <main id="main-content" className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
      {isAgent ? (
        <aside
          aria-label="Panel de teléfono"
          className="sticky top-0 hidden h-dvh w-[22rem] shrink-0 border-l border-neutral-200 xl:flex xl:flex-col"
        >
          <PhonePanel />
        </aside>
      ) : null}
      {isAgent ? (
        <Drawer open={phoneOpen} title="Teléfono" side="right" onClose={closePhone}>
          <PhonePanel />
        </Drawer>
      ) : null}
    </div>
  );
}
