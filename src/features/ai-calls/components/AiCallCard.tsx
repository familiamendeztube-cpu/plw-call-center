import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarPlus, ChevronDown, Phone, Play } from 'lucide-react';
import {
  CUSTOMER_ACTION_PARAM,
  CUSTOMER_ACTION_SCHEDULE,
  CUSTOMER_REASON_PARAM,
} from '@/features/customers/models/customerLinks';
import { formatDateTime } from '@/app/dates';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { cx } from '@/components/ui/cx';
import { useAuth } from '@/features/auth/context/useAuth';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { toCostaRicaNumber } from '@/features/telephony/models/call';
import {
  loadAiCallAudio,
  setAiCallStatus,
  type CallAudioTarget,
} from '@/features/ai-calls/hooks/useAiCalls';
import {
  AI_CALL_STATUSES,
  AI_CALL_STATUS_LABELS,
  CONTACT_LABELS,
  contactNumber,
  waitingLabel,
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

type Recording =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error'; message: string };

/** Loads the recording only when asked: it is a few MB and most cards are never played. */
export function CallRecording({ target, startSeconds }: { target: CallAudioTarget; startSeconds?: number }) {
  const [recording, setRecording] = useState<Recording>({ status: 'idle' });
  useEffect(
    () => () => {
      if (recording.status === 'ready') URL.revokeObjectURL(recording.url);
    },
    [recording]
  );

  async function load() {
    setRecording({ status: 'loading' });
    try {
      setRecording({ status: 'ready', url: URL.createObjectURL(await loadAiCallAudio(target)) });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo cargar la grabación.';
      setRecording({ status: 'error', message });
    }
  }

  if (recording.status === 'ready') {
    return (
      <audio
        controls
        autoPlay
        src={recording.url}
        onLoadedMetadata={(event) => {
          if (startSeconds && startSeconds < event.currentTarget.duration) event.currentTarget.currentTime = startSeconds;
        }}
        className="w-full"
        aria-label="Grabación de la llamada"
      />
    );
  }
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={recording.status === 'loading'}
        onClick={() => void load()}
      >
        <Play size={14} aria-hidden="true" />
        {recording.status === 'loading' ? 'Cargando grabación...' : startSeconds ? 'Escuchar desde el dictado' : 'Escuchar la llamada'}
      </Button>
      {recording.status === 'error' ? (
        <p role="alert" className="w-full text-sm text-danger-700">
          {recording.message}
        </p>
      ) : null}
    </>
  );
}

export function AiCallCard({ call, agentNames, canDial, onChanged }: AiCallCardProps) {
  const { changeDialNumber } = useTelephony();
  const [, setSearchParams] = useSearchParams();
  const isAdmin = useAuth().session?.role === 'admin';
  const waiting = waitingLabel(call, Date.now());
  // Inside the customer's screen, which opens its "Agendar" dialog from these parameters.
  const scheduleCallback = () =>
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(CUSTOMER_ACTION_PARAM, CUSTOMER_ACTION_SCHEDULE);
      next.set(
        CUSTOMER_REASON_PARAM,
        call.preferredTime ? `Llamar · prefiere: ${call.preferredTime}` : 'Devolver la llamada'
      );
      return next;
    });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // While closing, the text stays unclamped so it has a height to shrink from; the "…" clamp
  // goes back on when the shrink ends. Without calc-size nothing animates, so clamp at once.
  const [summaryClosing, setSummaryClosing] = useState(false);
  const toggleSummary = () => {
    const animates = typeof CSS !== 'undefined' && CSS.supports('height', 'calc-size(auto, size)');
    if (summaryOpen && animates) setSummaryClosing(true);
    setSummaryOpen(!summaryOpen);
  };
  const footer = [
    call.statusBy && call.statusAt
      ? `Último cambio: ${agentNames[call.statusBy] ?? call.statusBy}, ${formatDateTime(call.statusAt)}`
      : null,
    // Only administrators need the ElevenLabs reference, to look a call up there.
    isAdmin ? `ID de ElevenLabs: ${call.conversationId}` : null,
  ].filter(Boolean);
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
        {call.preferredContact ? (
          <Badge tone="gold">Prefiere: {CONTACT_LABELS[call.preferredContact]}</Badge>
        ) : null}
        <span className="text-sm text-neutral-500">{formatDateTime(call.callStartedAt)}</span>
        {waiting ? <Badge tone={waiting.late ? 'danger' : 'neutral'}>{waiting.text}</Badge> : null}
        {call.prospectId ? (
          <span className="text-sm text-neutral-500">
            · {ownerId ? (agentNames[ownerId] ?? ownerId) : 'En espera de un agente disponible'}
          </span>
        ) : (
          <Badge tone="warning">No enviada a un agente</Badge>
        )}
      </div>

      <div className="mt-3 rounded-lg bg-plw-ivory px-4 py-3">
        <button
          type="button"
          aria-expanded={summaryOpen}
          aria-controls={`summary-${call.id}`}
          onClick={toggleSummary}
          className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold uppercase tracking-wider text-plw-gold"
        >
          Resumen de la llamada
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={cx('shrink-0 transition-transform', summaryOpen && 'rotate-180')}
          />
        </button>
        {/* Closed it is at most two lines (calc-size keeps short summaries short); open it grows
            to its full height. Browsers without calc-size jump straight there, as before. */}
        <p
          id={`summary-${call.id}`}
          onTransitionEnd={(event) => {
            if (event.propertyName === 'height') setSummaryClosing(false);
          }}
          className={cx(
            'mt-1 overflow-hidden text-sm transition-[height] duration-300 ease-out-strong',
            call.summary ? 'text-plw-ink' : 'text-neutral-400',
            summaryOpen ? 'h-auto' : 'h-[calc-size(auto,min(size,2lh))]',
            !summaryOpen && !summaryClosing && 'line-clamp-2'
          )}
        >
          {call.summary ?? 'ElevenLabs no envió un resumen de esta llamada.'}
        </p>
      </div>

      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <Field label="Cliente" value={call.customerName} />
        <Field label="Negocio" value={call.businessName} />
        <Field label="Giro del negocio" value={call.businessType} />
        <Field label="Teléfono" value={number} />
        <Field label="Qué quiere mejorar" value={call.reason} />
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
        {canDial && call.prospectId ? (
          <Button size="sm" variant="ghost" onClick={scheduleCallback}>
            <CalendarPlus size={14} aria-hidden="true" />
            Agendar seguimiento
          </Button>
        ) : null}
        <CallRecording target={{ requestId: call.id }} />
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
      {footer.length > 0 ? (
        <p className="mt-3 text-xs text-neutral-500">{footer.join(' · ')}</p>
      ) : null}
    </Panel>
  );
}
