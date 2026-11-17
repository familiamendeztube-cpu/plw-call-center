import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, X } from 'lucide-react';
import { useAppServices } from '@/app/ServicesContext';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { useAgentSession } from '@/features/auth/hooks/useAgentSession';
import {
  CUSTOMER_ACTION_PARAM,
  CUSTOMER_ACTION_SCHEDULE,
  CUSTOMER_PARAM,
} from '@/features/customers/models/customerLinks';
import { NewCustomerDialog } from '@/features/leads/components/NewCustomerDialog';
import { useAgentProspects } from '@/features/leads/context/agentProspectsContext';
import type { Prospect } from '@/features/leads/models/prospect';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import {
  formatCallDuration,
  isCallLive,
  toCostaRicaNumber,
  type CallDirection,
} from '@/features/telephony/models/call';

const CALL_RESULTS = [
  'Habló con el cliente',
  'No contestó',
  'Buzón de voz',
  'Número equivocado',
] as const;

interface EndedCall {
  id: string;
  number: string;
  direction: CallDirection;
  /** Someone answered. */
  connected: boolean;
  durationSeconds: number;
}

/** The private note saved on the customer, e.g. "Llamada saliente · 02:13 · Buzón de voz". */
function callNoteText(call: EndedCall, result: string, note: string): string {
  const kind = call.direction === 'outbound' ? 'Llamada saliente' : 'Llamada entrante';
  const head = `${kind} · ${formatCallDuration(call.durationSeconds)} · ${result}`;
  return note.trim() ? `${head}\n${note.trim()}` : head;
}

/**
 * After every call: what happened, a note on the customer, and the next step. Stays until the
 * agent saves or closes it; hidden while another call is live.
 */
export function CallWrapUp() {
  const { call, changeDialNumber } = useTelephony();
  const { agentId } = useAgentSession();
  const { findByPhone, reload } = useAgentProspects();
  const { leads } = useAppServices();
  const navigate = useNavigate();
  const [ended, setEnded] = useState<EndedCall | null>(null);
  const [result, setResult] = useState<string>(CALL_RESULTS[0]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const latched = useRef<string | null>(null);

  // The phone shows an ended call for a few seconds, then clears it; keep it here.
  useEffect(() => {
    if (call?.state !== 'ended' || latched.current === call.id) return;
    latched.current = call.id;
    const connected = call.startedAt !== null;
    setEnded({
      id: call.id,
      number: call.remoteNumber,
      direction: call.direction,
      connected,
      durationSeconds: call.startedAt
        ? Math.max(0, Math.round((Date.now() - Date.parse(call.startedAt)) / 1000))
        : 0,
    });
    setResult(connected ? CALL_RESULTS[0] : CALL_RESULTS[1]);
    setNote('');
    setError(null);
  }, [call]);

  if (!ended || (call && isCallLive(call.state))) return null;

  const customer = findByPhone(ended.number);
  const dialable = toCostaRicaNumber(ended.number);
  const close = () => setEnded(null);

  const save = async (target: Prospect, schedule: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await leads.addNote({
        prospectId: target.id,
        agentId,
        body: callNoteText(ended, result, note),
      });
      close();
      const params = new URLSearchParams({ [CUSTOMER_PARAM]: target.id });
      if (schedule) params.set(CUSTOMER_ACTION_PARAM, CUSTOMER_ACTION_SCHEDULE);
      if (schedule) navigate(`/clientes?${params.toString()}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la nota.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside
      aria-label="Después de la llamada"
      className="fixed inset-x-4 bottom-4 z-40 mx-auto grid max-h-[60dvh] max-w-sm gap-3 overflow-y-auto overscroll-contain rounded-xl border border-plw-navy/20 bg-white p-4 shadow-xl sm:left-4 sm:right-auto sm:mx-0"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-plw-navy">
            {ended.direction === 'outbound' ? 'Llamada saliente' : 'Llamada entrante'} ·{' '}
            {formatCallDuration(ended.durationSeconds)}
          </p>
          <p className="truncate text-base font-semibold text-plw-ink">
            {customer?.businessName ?? ended.number}
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Cerrar sin guardar"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/60"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div role="radiogroup" aria-label="Resultado" className="flex flex-wrap gap-1.5">
        {CALL_RESULTS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={result === option}
            onClick={() => setResult(option)}
            className={cx(
              'h-7 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/60',
              result === option
                ? 'bg-plw-navy text-white ring-plw-navy'
                : 'bg-neutral-50 text-neutral-700 ring-neutral-200 hover:bg-neutral-100'
            )}
          >
            {option}
          </button>
        ))}
      </div>

      <label className="grid gap-1 text-sm">
        <span className="text-xs font-medium text-neutral-600">Nota (opcional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={1500}
          placeholder="Qué acordaron, qué le interesa…"
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-plw-ink focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30"
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-danger-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {customer ? (
          <>
            <Button size="sm" disabled={saving} onClick={() => void save(customer, false)}>
              Guardar nota
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={saving}
              onClick={() => void save(customer, true)}
            >
              Guardar y agendar
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={saving} onClick={() => setAdding(true)}>
            Agregar como cliente
          </Button>
        )}
        {dialable && !ended.connected ? (
          <Button size="sm" variant="ghost" onClick={() => changeDialNumber(dialable)}>
            <Phone size={14} aria-hidden="true" />
            Marcar de nuevo
          </Button>
        ) : null}
      </div>

      {adding ? (
        <NewCustomerDialog
          agentId={agentId}
          initialPhone={ended.number}
          onClose={() => setAdding(false)}
          onCreated={(created) => {
            setAdding(false);
            reload();
            void save(created, false);
            navigate(`/clientes?${CUSTOMER_PARAM}=${created.id}`);
          }}
        />
      ) : null}
    </aside>
  );
}
