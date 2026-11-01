import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import type { AdminAgent } from '@/features/admin/models/adminAgents';
import { revokeAgentSessions } from '@/features/admin/services/adminAgentService';

interface AgentSessionsDialogProps {
  agent: AdminAgent;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function AgentSessionsDialog({ agent, onClose, onSaved }: AgentSessionsDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const revoke = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await revokeAgentSessions(agent.id);
      onSaved(`Sesiones de ${agent.displayName} cerradas.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudieron cerrar las sesiones.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      title={`Cerrar sesiones de ${agent.displayName}`}
      description="Solo afecta a este agente."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={revoke} disabled={submitting}>
            {submitting ? 'Cerrando...' : 'Cerrar sesiones'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-600">
          {agent.displayName} quedará desconectado de todos sus equipos y deberá ingresar de nuevo
          con su PIN.
        </p>
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-700">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
