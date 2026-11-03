import { useState } from 'react';
import { Phone } from 'lucide-react';
import { formatDateTime } from '@/app/dates';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { toCostaRicaNumber } from '@/features/telephony/models/call';
import { setAiCallStatus } from '@/features/ai-calls/hooks/useAiCalls';
import {
  AI_CALL_STATUSES,
  AI_CALL_STATUS_LABELS,
  CONTACT_LABELS,
  contactNumber,
  type AiCall,
  type AiCallStatus,
} from '@/features/ai-calls/models/aiCall';

interface AiCallCardProps {
  call: AiCall;
  agentNames: Record<string, string>;
  canDial: boolean;
  onChanged: () => void;
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className={value ? 'text-plw-ink' : 'text-neutral-400'}>{value ?? 'No indicado'}</dd>
    </div>
  );
}

export function AiCallCard({ call, agentNames, canDial, onChanged }: AiCallCardProps) {
  const { changeDialNumber } = useTelephony();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const number = contactNumber(call);
  const dialable = toCostaRicaNumber(number ?? '');
  const ownerId = call.prospect?.ownerId ?? null;

  async function changeStatus(status: AiCallStatus) {
    setSaving(true);
    try {
      await setAiCallStatus(call.id, status);
      setError(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cambiar el estado.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel as="article" className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="navy">Asistente IA · ElevenLabs</Badge>
        <span className="text-sm text-neutral-500">{formatDateTime(call.callStartedAt)}</span>
        {call.prospectId ? (
          <span className="text-sm text-neutral-500">
            · {ownerId ? (agentNames[ownerId] ?? ownerId) : 'En espera de un agente disponible'}
          </span>
        ) : (
          <Badge tone="warning">No enviada a un agente</Badge>
        )}
      </div>

      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <Field label="Cliente" value={call.customerName} />
        <Field label="Negocio" value={call.businessName} />
        <Field label="Teléfono" value={number} />
        <Field label="Motivo" value={call.reason} />
        <Field
          label="Contacto solicitado"
          value={call.preferredContact ? CONTACT_LABELS[call.preferredContact] : null}
        />
        <Field label="Horario preferido" value={call.preferredTime} />
        <Field
          label="Autorizó que lo contacten"
          value={call.consent === null ? null : call.consent ? 'Sí' : 'No'}
        />
      </dl>
      {call.summary ? <p className="mt-3 text-sm text-plw-ink">{call.summary}</p> : null}
      {call.preferredContact === 'whatsapp' ? (
        <p className="mt-2 text-sm text-neutral-600">
          Prefiere WhatsApp: contáctalo por Chatwoot o la línea de WhatsApp aprobada y registra el
          resultado aquí.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {canDial && dialable ? (
          <Button size="sm" variant="secondary" onClick={() => changeDialNumber(dialable)}>
            <Phone size={14} aria-hidden="true" />
            Marcar en el teléfono
          </Button>
        ) : null}
        {call.prospectId ? (
          <label className="flex items-center gap-2 text-sm">
            Estado
            <select
              className="rounded-lg border border-neutral-300 px-2 py-1"
              value={call.status}
              disabled={saving}
              onChange={(event) => void changeStatus(event.target.value as AiCallStatus)}
            >
              {AI_CALL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {AI_CALL_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger-700">
          {error}
        </p>
      ) : null}
      <p className="mt-3 text-xs text-neutral-500">
        {call.statusBy && call.statusAt
          ? `Último cambio: ${agentNames[call.statusBy] ?? call.statusBy}, ${formatDateTime(call.statusAt)} · `
          : ''}
        ID de ElevenLabs: {call.conversationId}
      </p>
    </Panel>
  );
}
