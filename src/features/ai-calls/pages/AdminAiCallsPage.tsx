import { useState } from 'react';
import { useAsync } from '@/app/useAsync';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useAgentNames } from '@/features/auth/hooks/useAgentNames';
import { AiCallCard } from '@/features/ai-calls/components/AiCallCard';
import { countRecentWebhookFailures, useAiCalls } from '@/features/ai-calls/hooks/useAiCalls';
import {
  AI_CALL_STATUSES,
  AI_CALL_STATUS_LABELS,
  type AiCallStatus,
} from '@/features/ai-calls/models/aiCall';

export function AdminAiCallsPage() {
  const [status, setStatus] = useState<AiCallStatus | ''>('');
  const { state, refresh } = useAiCalls({ status: status || undefined });
  const failures = useAsync(countRecentWebhookFailures, []);
  const agentNames = useAgentNames();

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Solicitudes IA"
        description="Llamadas atendidas por el asistente de ElevenLabs. Se reparten por turno entre los agentes en Activo; para cambiar de agente use Asignaciones."
        actions={
          <label className="flex items-center gap-2 text-sm">
            Estado
            <select
              className="rounded-lg border border-neutral-300 px-2 py-1"
              value={status}
              onChange={(event) => setStatus(event.target.value as AiCallStatus | '')}
            >
              <option value="">Todas</option>
              {AI_CALL_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {AI_CALL_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        }
      />
      {failures.state.status === 'ready' && failures.state.data > 0 ? (
        <p role="alert" className="text-sm text-danger-700">
          Entregas de ElevenLabs con errores o sin datos del cliente en los últimos 7 días:{' '}
          {failures.state.data}.
        </p>
      ) : null}
      {state.status === 'loading' ? (
        <StatusMessage tone="loading" title="Cargando solicitudes..." />
      ) : state.status === 'error' ? (
        <StatusMessage tone="error" title={state.message} />
      ) : state.data.length === 0 ? (
        <StatusMessage
          tone="empty"
          title="No hay solicitudes."
          description="Aparecerán aquí cuando el asistente IA termine una llamada."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {state.data.map((call) => (
            <AiCallCard
              key={call.id}
              call={call}
              agentNames={agentNames}
              canDial={false}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
