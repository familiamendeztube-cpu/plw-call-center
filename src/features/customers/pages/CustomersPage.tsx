import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PanelLeft, RotateCcw } from 'lucide-react';
import { useAgentSession } from '@/features/auth/hooks/useAgentSession';
import { useAgentNames } from '@/features/auth/hooks/useAgentNames';
import { useProspects } from '@/features/leads/hooks/useProspects';
import { useNewAssignments } from '@/features/customers/hooks/useNewAssignments';
import { useConversations } from '@/features/inbox/hooks/useConversations';
import { CustomerList } from '@/features/customers/components/CustomerList';
import { CustomerWorkspace } from '@/features/customers/components/CustomerWorkspace';
import { buildCustomerEntries } from '@/features/customers/models/customerEntries';
import { CUSTOMER_PARAM } from '@/features/customers/models/customerLinks';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { DemoDataNote } from '@/components/ui/DemoDataNote';
import { AiCallAlerts } from '@/features/ai-calls/components/AiCallSections';

export function CustomersPage() {
  const { agentId } = useAgentSession();
  const prospects = useProspects();
  const conversations = useConversations(agentId);
  const agentNames = useAgentNames();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const closeList = useCallback(() => setListOpen(false), []);
  const selectedId = searchParams.get(CUSTOMER_PARAM);

  const entries = useMemo(() => {
    if (prospects.state.status !== 'ready' || conversations.state.status !== 'ready') {
      return null;
    }
    const assigned = prospects.state.data.filter((item) => item.assignedAgentId === agentId);
    return buildCustomerEntries(assigned, conversations.state.data);
  }, [prospects.state, conversations.state, agentId]);

  const selected = entries?.find((entry) => entry.prospect.id === selectedId) ?? null;
  const assignedIds = useMemo(() => entries?.map((entry) => entry.prospect.id) ?? null, [entries]);
  const newAssignments = useNewAssignments(assignedIds);

  const handleSelect = (prospectId: string) => {
    setSearchParams({ [CUSTOMER_PARAM]: prospectId });
    setListOpen(false);
    conversations.updateData((list) =>
      list.map((item) => (item.prospectId === prospectId ? { ...item, unread: false } : item))
    );
  };

  const failure = [prospects.state, conversations.state].find((state) => state.status === 'error');
  const reloadAll = () => {
    prospects.reload();
    conversations.reload();
  };

  let listContent: ReactNode = <StatusMessage tone="loading" title="Cargando clientes..." />;
  if (failure && failure.status === 'error') {
    listContent = (
      <StatusMessage
        tone="error"
        title="No se pudieron cargar tus clientes."
        description={failure.message}
        action={
          <Button variant="secondary" size="sm" onClick={reloadAll}>
            <RotateCcw size={14} aria-hidden="true" />
            Reintentar
          </Button>
        }
      />
    );
  } else if (entries) {
    listContent = (
      <CustomerList
        entries={entries}
        selectedId={selectedId}
        query={query}
        onQueryChange={setQuery}
        onSelect={handleSelect}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Clientes"
        description="Tus clientes asignados, sus correos, lo que les ofreces y las presentaciones aprobadas."
        actions={
          <>
            <DemoDataNote />
            <Button
              variant="secondary"
              size="sm"
              className="lg:hidden"
              onClick={() => setListOpen(true)}
            >
              <PanelLeft size={16} aria-hidden="true" />
              Clientes
            </Button>
          </>
        }
      />

      {newAssignments.count > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-plw-gold/40 bg-plw-gold-soft/40 px-5 py-3"
        >
          <p className="text-sm font-medium text-plw-navy">
            {newAssignments.count === 1
              ? 'Te asignaron un cliente nuevo.'
              : `Te asignaron ${newAssignments.count} clientes nuevos.`}
          </p>
          <Button variant="ghost" size="sm" onClick={newAssignments.dismiss}>
            Entendido
          </Button>
        </div>
      ) : null}

      <AiCallAlerts onSelect={handleSelect} />

      {/* Fits the screen, so chats and lists scroll inside it instead of stretching the page. */}
      <div className="grid h-[calc(100dvh-2rem)] min-h-[34rem] lg:h-[calc(100dvh-16rem)] lg:min-h-[40rem] grid-cols-1 overflow-hidden rounded-xl border border-neutral-200/80 bg-white shadow-panel lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="hidden min-h-0 border-r border-neutral-200 lg:flex lg:flex-col">
          {listContent}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col">
          {selected ? (
            <CustomerWorkspace
              key={selected.prospect.id}
              entry={selected}
              agentId={agentId}
              agentNames={agentNames}
            />
          ) : (
            <div className="flex h-full min-h-[24rem] items-center justify-center">
              <StatusMessage
                tone="empty"
                title="Selecciona un cliente para comenzar."
                description="Verás sus correos, lo que le ofreces y las presentaciones aquí."
              />
            </div>
          )}
        </div>
      </div>

      <Drawer open={listOpen} title="Clientes" onClose={closeList}>
        <div className="flex h-full flex-col">{listContent}</div>
      </Drawer>
    </div>
  );
}
