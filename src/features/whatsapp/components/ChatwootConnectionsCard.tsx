import { useState } from 'react';
import { IS_DEMO_MODE } from '@/app/appConfig';
import { useAsync } from '@/app/useAsync';
import { formatDateTime } from '@/app/dates';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useAgentNames } from '@/features/auth/hooks/useAgentNames';
import { disconnectChatwoot } from '@/features/whatsapp/hooks/useWhatsApp';
import { callStaffFunction, INVALID_RESPONSE } from '@/integrations/supabase/callStaffFunction';

interface Connection {
  staffId: string;
  chatwootUserId: number;
  name: string;
  email: string;
  connectedAt: string;
}

async function loadConnections(): Promise<Connection[]> {
  const payload = await callStaffFunction('whatsapp', { action: 'list_connections' });
  if (!Array.isArray(payload.connections)) throw new Error(INVALID_RESPONSE);
  return payload.connections as Connection[];
}

/** Which Chatwoot user each agent answers WhatsApp as. Tokens never reach this screen. */
export function ChatwootConnectionsCard() {
  return (
    <Panel className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-base font-semibold text-plw-ink">WhatsApp por Chatwoot</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Cada agente conecta su propio usuario de Chatwoot desde el chat de un cliente, y sus
          respuestas salen con su nombre. Revisa que cada agente esté conectado como sí mismo.
        </p>
      </div>
      {IS_DEMO_MODE ? (
        <p className="rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
          WhatsApp solo está disponible en la versión conectada al servidor.
        </p>
      ) : (
        <ConnectionList />
      )}
    </Panel>
  );
}

function ConnectionList() {
  const { state, reload } = useAsync(loadConnections, []);
  const agentNames = useAgentNames();
  const [busy, setBusy] = useState<string | null>(null);

  if (state.status === 'loading') {
    return <StatusMessage tone="loading" title="Cargando conexiones" />;
  }
  if (state.status === 'error') {
    return (
      <StatusMessage
        tone="error"
        title="No se pudieron cargar las conexiones"
        description={state.message}
        action={
          <Button variant="secondary" size="sm" onClick={reload}>
            Reintentar
          </Button>
        }
      />
    );
  }
  if (state.data.length === 0) {
    return <p className="text-sm text-neutral-600">Ningún agente ha conectado Chatwoot todavía.</p>;
  }

  const disconnect = async (staffId: string) => {
    setBusy(staffId);
    await disconnectChatwoot(staffId).catch(() => undefined);
    setBusy(null);
    reload();
  };

  return (
    <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
      {state.data.map((connection) => (
        <li
          key={connection.staffId}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <div className="text-sm">
            <p className="font-medium text-plw-ink">
              {agentNames[connection.staffId] ?? connection.staffId} → {connection.name}
            </p>
            <p className="text-neutral-500">
              {connection.email || 'Sin correo'} · usuario #{connection.chatwootUserId} · desde{' '}
              {formatDateTime(connection.connectedAt)}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy === connection.staffId}
            onClick={() => void disconnect(connection.staffId)}
          >
            Desconectar
          </Button>
        </li>
      ))}
    </ul>
  );
}
