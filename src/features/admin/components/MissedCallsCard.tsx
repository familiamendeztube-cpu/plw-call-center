import { useAsync } from '@/app/useAsync';
import { formatDateTime } from '@/app/dates';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { missedCalls } from '@/features/admin/models/missedCalls';
import { loadPhoneRecords } from '@/features/admin/services/phoneRecords';
import { findCustomerByPhone } from '@/features/customers/models/customerEntries';
import type { Prospect } from '@/features/leads/models/prospect';
import { formatPhone, originLabel } from '@/features/telephony/models/call';

const DAYS = 7;

interface MissedCallsCardProps {
  prospects: Prospect[];
  agentNames: Record<string, string>;
  /** Registers the caller as an inquiry, assigned by round-robin like any other. */
  onCreateInquiry: (phone: string) => void;
}

/** Callers who hung up before an agent or the AI receptionist answered, and who called back. */
export function MissedCallsCard({ prospects, agentNames, onCreateInquiry }: MissedCallsCardProps) {
  const { state, reload } = useAsync(() => loadPhoneRecords(DAYS), []);

  return (
    <section
      aria-labelledby="missed-calls-heading"
      className="glass-panel flex flex-col gap-3 rounded-xl p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="missed-calls-heading" className="text-lg font-semibold text-plw-ink">
          Llamadas perdidas · últimos {DAYS} días
        </h2>
        <Button variant="ghost" size="sm" onClick={reload}>
          Actualizar
        </Button>
      </div>
      <p className="text-sm text-neutral-600">
        Entrantes que nadie contestó, ni un agente ni la recepcionista IA. Se marcan como devueltas
        cuando alguien vuelve a hablar con ese número.
      </p>
      {state.status === 'loading' ? <p className="text-sm">Cargando…</p> : null}
      {state.status === 'error' ? (
        <p role="alert" className="text-sm text-danger-700">
          {state.message}
        </p>
      ) : null}
      {state.status === 'ready' ? (
        <MissedList
          calls={missedCalls(state.data)}
          prospects={prospects}
          agentNames={agentNames}
          onCreateInquiry={onCreateInquiry}
        />
      ) : null}
    </section>
  );
}

function MissedList({
  calls,
  prospects,
  agentNames,
  onCreateInquiry,
}: MissedCallsCardProps & { calls: ReturnType<typeof missedCalls> }) {
  if (calls.length === 0) {
    return <p className="text-sm text-neutral-600">No hubo llamadas perdidas.</p>;
  }
  return (
    <ul className="divide-y divide-neutral-200">
      {calls.map((call) => {
        const customer = findCustomerByPhone(prospects, call.number);
        const owner = customer?.assignedAgentId ? agentNames[customer.assignedAgentId] : null;
        return (
          <li key={call.linkedId} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-plw-ink">
                {customer ? customer.businessName : formatPhone(call.number)}
              </p>
              <p className="text-xs text-neutral-500">
                {customer ? `${formatPhone(call.number)} · ` : ''}
                {originLabel(call.number) ? `${originLabel(call.number)} · ` : ''}
                {formatDateTime(call.at)}
                {owner ? ` · Cliente de ${owner}` : ''}
              </p>
            </div>
            {call.returned ? (
              <Badge tone="success">
                Devuelta
                {call.returned.staffId
                  ? ` por ${agentNames[call.returned.staffId] ?? 'un agente'}`
                  : ''}
                , {formatDateTime(call.returned.at)}
              </Badge>
            ) : (
              <Badge tone="danger">Sin devolver</Badge>
            )}
            <CopyButton value={call.number} label={`Copiar el número ${call.number}`} />
            {!customer && !call.returned ? (
              <Button size="sm" variant="secondary" onClick={() => onCreateInquiry(call.number)}>
                Crear consulta
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
