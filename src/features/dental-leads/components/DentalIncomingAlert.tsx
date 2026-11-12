import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/context/useAuth';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { useIncomingDentalCall } from '../hooks/useIncomingDentalCall';
import {
  dentalContext,
  isIncomingRinging,
  showCompactContext,
  type IncomingDentalContext,
} from '../models/incomingDentalCall';

const RECENT_LINES = 8;

export function DentalIncomingAlert() {
  const { session } = useAuth();
  const { call, answerCall, hangUp } = useTelephony();
  const agentId = session?.role === 'agent' ? session.agentId : null;
  const lookup = useIncomingDentalCall(call, agentId);
  const context = dentalContext(call, agentId, lookup);
  const historyLink = call?.dentalCallId
    ? `/llamadas-dentales?call=${encodeURIComponent(call.dentalCallId)}`
    : '/llamadas-dentales';

  if (isIncomingRinging(call)) {
    return (
      <section
        role="alertdialog"
        aria-live="assertive"
        aria-label="Llamada entrante"
        className="fixed inset-x-4 top-4 z-50 mx-auto grid max-h-[calc(100dvh-2rem)] max-w-2xl gap-4 overflow-y-auto overscroll-contain rounded-2xl border-2 border-plw-navy bg-white p-6 shadow-2xl sm:p-8"
      >
        <p className="text-sm font-semibold uppercase tracking-wide text-plw-navy">
          Llamada entrante
        </p>
        <p className="break-all text-4xl font-bold tabular-nums text-neutral-900 sm:text-5xl">
          {call.remoteNumber}
        </p>
        <DentalDetails context={context} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="success" size="lg" onClick={() => void answerCall()}>
            Contestar
          </Button>
          <Button variant="danger" size="lg" onClick={() => void hangUp()}>
            Rechazar
          </Button>
          {context.kind === 'ready' && (
            <Link
              to={historyLink}
              className="ml-auto text-sm font-semibold text-plw-navy underline underline-offset-4"
            >
              Ver llamada
            </Link>
          )}
        </div>
      </section>
    );
  }

  if (showCompactContext(call) && context.kind === 'ready') {
    return (
      <aside
        aria-label="Contexto de la llamada dental"
        className="fixed inset-x-4 bottom-4 z-40 mx-auto grid max-h-[40dvh] max-w-sm gap-2 overflow-y-auto overscroll-contain rounded-xl border border-plw-navy/20 bg-white p-4 shadow-xl sm:left-auto sm:right-4 sm:mx-0"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-plw-navy">
          Dentista en esta llamada
        </p>
        <DentalDetails context={context} compact />
        <Link
          to={historyLink}
          className="text-sm font-semibold text-plw-navy underline underline-offset-4"
        >
          Ver llamada
        </Link>
      </aside>
    );
  }

  return null;
}

function DentalDetails({
  context,
  compact = false,
}: {
  context: IncomingDentalContext;
  compact?: boolean;
}) {
  if (context.kind === 'none') return null;
  if (context.kind === 'loading') {
    return (
      <p role="status" className="text-base text-neutral-700">
        Buscando el dentista de esta llamada…
      </p>
    );
  }
  if (context.kind === 'unavailable') {
    return (
      <p role="status" className="text-sm text-neutral-600">
        No pudimos vincular esta llamada con un dentista de su lista. Puede contestar igual.
      </p>
    );
  }
  const { lead, call } = context;
  const location = [lead?.address, lead?.canton, lead?.province].filter(Boolean).join(', ');
  const contact = call.details?.contact_name || lead?.contact_name;
  const summary = call.summary?.trim();
  // The end of the conversation is what the dentist agreed to before the transfer.
  const lines = (call.transcript ?? [])
    .filter((line) => line.message.trim())
    .slice(-RECENT_LINES);
  return (
    <div className="grid gap-3">
      <h2 className={compact ? 'text-lg font-semibold text-plw-navy' : 'text-2xl font-semibold text-plw-navy'}>
        {lead?.business_name ?? 'Dentista sin nombre registrado'}
      </h2>
      {contact && (
        <p className="text-sm text-neutral-800">
          Contacto: <span className="font-semibold">{contact}</span>
        </p>
      )}
      {location && <p className="text-sm text-neutral-700">{location}</p>}
      <div className="grid gap-1 rounded-lg bg-plw-ivory p-3 text-sm">
        <p className="font-semibold">Lo que habló con Anna</p>
        {summary && <p className="whitespace-pre-wrap">{summary}</p>}
        {lines.map((line, i) => (
          <p key={i}>
            <span className="font-semibold">{line.role === 'agent' ? 'Anna' : 'Dentista'}:</span>{' '}
            {line.message}
          </p>
        ))}
        {!summary && !lines.length && (
          <p>La conversación todavía no llega. Aparece aquí en unos segundos.</p>
        )}
      </div>
    </div>
  );
}
