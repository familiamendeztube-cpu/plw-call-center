import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { AgentManagementCard } from '@/features/admin/components/AgentManagementCard';
import { AgentPinDialog } from '@/features/admin/components/AgentPinDialog';
import { AgentProfileDialog } from '@/features/admin/components/AgentProfileDialog';
import { AgentSessionsDialog } from '@/features/admin/components/AgentSessionsDialog';
import { useAdminAgents } from '@/features/admin/hooks/useAdminAgents';
import type { AdminAgent } from '@/features/admin/models/adminAgents';

type AgentDialog = { kind: 'profile' | 'pin' | 'sessions'; agent: AdminAgent } | null;

export function AgentManagementSection() {
  const { state, reload } = useAdminAgents();
  const [dialog, setDialog] = useState<AgentDialog>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSaved = async (message: string) => {
    setDialog(null);
    setNotice(message);
    await reload();
  };

  return (
    <section aria-labelledby="agent-management-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="agent-management-heading" className="text-lg font-semibold text-plw-ink">
          Cuentas de agentes
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Incluye agentes deshabilitados. Los agentes ingresan solo con su PIN.
        </p>
      </div>

      {notice ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-success-100 bg-success-50 px-4 py-3 text-sm font-medium text-success-700"
        >
          <CheckCircle2 size={16} aria-hidden="true" />
          {notice}
        </p>
      ) : null}

      {state.status === 'loading' ? (
        <StatusMessage tone="loading" title="Cargando cuentas de agentes..." />
      ) : null}
      {state.status === 'error' ? (
        <StatusMessage
          tone="error"
          title="No se pudieron cargar las cuentas."
          description={state.message}
          action={
            <button
              type="button"
              onClick={() => void reload()}
              className="text-sm font-medium text-plw-navy underline-offset-4 hover:text-plw-gold hover:underline"
            >
              Intentar de nuevo
            </button>
          }
        />
      ) : null}
      {state.status === 'ready' ? (
        <div className="grid gap-4 md:grid-cols-3">
          {state.agents.map((agent) => (
            <AgentManagementCard
              key={agent.id}
              agent={agent}
              onEditProfile={() => {
                setNotice(null);
                setDialog({ kind: 'profile', agent });
              }}
              onChangePin={() => {
                setNotice(null);
                setDialog({ kind: 'pin', agent });
              }}
              onRevokeSessions={() => {
                setNotice(null);
                setDialog({ kind: 'sessions', agent });
              }}
            />
          ))}
        </div>
      ) : null}

      {dialog?.kind === 'profile' ? (
        <AgentProfileDialog
          agent={dialog.agent}
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
        />
      ) : null}
      {dialog?.kind === 'pin' ? (
        <AgentPinDialog
          agent={dialog.agent}
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
        />
      ) : null}
      {dialog?.kind === 'sessions' ? (
        <AgentSessionsDialog
          agent={dialog.agent}
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </section>
  );
}
