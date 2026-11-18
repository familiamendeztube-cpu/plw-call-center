import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PanelLeft, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useAgentNames } from '@/features/auth/hooks/useAgentNames';
import { useAdminSnapshot } from '@/features/admin/hooks/useAdminSnapshot';
import {
  buildCustomerEntries,
} from '@/features/customers/models/customerEntries';
import { CUSTOMER_PARAM } from '@/features/customers/models/customerLinks';
import { CustomerList } from '@/features/customers/components/CustomerList';
import { CustomerWorkspace } from '@/features/customers/components/CustomerWorkspace';

/**
 * The administrator's own Clientes: the same customer workspace the agents use, fed from the
 * admin snapshot (every prospect and conversation). The open customer and its tab live in the
 * URL, so the chat survives a refresh, and the drawer keeps the list reachable on mobile.
 */
export function AdminCustomersPage() {
  const { state, reload, refresh } = useAdminSnapshot();
  const agentNames = useAgentNames();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);

  const selectedId = searchParams.get(CUSTOMER_PARAM);
  const entries = useMemo(
    () =>
      state.status === 'ready'
        ? buildCustomerEntries(state.data.prospects, state.data.conversations)
        : null,
    [state]
  );
  const selected = entries?.find((entry) => entry.prospect.id === selectedId) ?? null;

  const failure = state.status === 'error' ? state.message : null;
  const listContent: ReactNode = failure ? (
    <StatusMessage
      tone="error"
      title="No se pudieron cargar los clientes."
      description={failure}
      action={
        <Button variant="secondary" size="sm" onClick={reload}>
          <RotateCcw size={14} aria-hidden="true" />
          Reintentar
        </Button>
      }
    />
  ) : entries ? (
    <CustomerList
      entries={entries}
      selectedId={selectedId}
      query={query}
      onQueryChange={setQuery}
      stage={null}
      onStageChange={() => {}}
      onSelect={(prospectId) => {
        setSearchParams({ [CUSTOMER_PARAM]: prospectId });
        setListOpen(false);
      }}
    />
  ) : (
    <StatusMessage tone="loading" title="Cargando clientes..." />
  );

  // The stage or details changed inside the chat: the snapshot refreshes in place, so the
  // customer list follows without waiting for the next poll.
  const handleProspectChange = () => refresh();

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Clientes"
        description="Los clientes del equipo, con su chat de WhatsApp, correos, llamadas y notas. Los chats se responden con el Chatwoot conectado de cada agente."
        actions={
          <Button
            variant="secondary"
            size="sm"
            className="lg:hidden"
            onClick={() => setListOpen(true)}
          >
            <PanelLeft size={16} aria-hidden="true" />
            Clientes
          </Button>
        }
      />
      <div className="grid h-[calc(100dvh-5.5rem)] min-h-[28rem] lg:h-[calc(100dvh-16rem)] lg:min-h-[min(40rem,calc(100dvh-6rem))] xl:min-h-[min(40rem,calc(100dvh-2rem))] grid-cols-1 overflow-hidden rounded-xl border border-neutral-200/80 bg-white shadow-panel lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="hidden min-h-0 border-r border-neutral-200 lg:flex lg:flex-col">
          {listContent}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col">
          {selected ? (
            <CustomerWorkspace
              key={selected.prospect.id}
              entry={selected}
              agentNames={agentNames}
              onProspectChange={handleProspectChange}
            />
          ) : (
            <div className="flex h-full min-h-[24rem] items-center justify-center">
              <StatusMessage
                tone="empty"
                title="Selecciona un cliente para comenzar."
                description="Verás su chat de WhatsApp, correos, llamadas y notas aquí."
              />
            </div>
          )}
        </div>
      </div>
      <Drawer open={listOpen} title="Clientes" onClose={() => setListOpen(false)}>
        <div className="flex h-full flex-col">{listContent}</div>
      </Drawer>
    </div>
  );
}
