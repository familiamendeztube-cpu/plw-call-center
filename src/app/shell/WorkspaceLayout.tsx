import { useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/useAuth';
import { AgentStatusControl } from '@/features/presence/components/AgentStatusControl';
import { PhonePanel } from '@/features/telephony/components/PhonePanel';
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

  return (
    <div className="flex min-h-dvh flex-col bg-plw-ivory">
      <AppHeader
        displayName={session?.displayName ?? ''}
        roleLabel={isAgent ? 'Agente de ventas' : 'Administrador'}
        statusControl={isAgent ? <AgentStatusControl /> : null}
        onOpenPhone={openPhone}
      />
      <WorkspaceNav
        items={navItems}
        label={isAgent ? 'Área de agente' : 'Área de administración'}
      />
      <div className="flex min-h-0 flex-1">
        <main id="main-content" className="min-w-0 flex-1">
          <Outlet />
        </main>
        <aside
          aria-label="Panel de teléfono"
          className="hidden w-[22rem] shrink-0 border-l border-neutral-200 xl:flex xl:flex-col"
        >
          <PhonePanel />
        </aside>
      </div>
      <Drawer open={phoneOpen} title="Teléfono" side="right" onClose={closePhone}>
        <PhonePanel />
      </Drawer>
    </div>
  );
}
