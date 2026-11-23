import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarCheck, CalendarClock, Globe, Mic, PhoneCall, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { buildPreviewUrl } from '@/features/site-draft/models/siteDraft';

interface HotelContext {
  businessName: string;
  locale: string;
  notice: string;
  exampleQuestion: string;
  siteSampleToken: string | null;
  booking: { id: string; slotStart: string; guestName: string } | null;
}

interface SlotInfo {
  id: string;
  slotStart: string;
}

const TIME_FMT = new Intl.DateTimeFormat('es-CR', {
  timeZone: 'America/Costa_Rica',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
});

const crLabel = (iso: string) => `${TIME_FMT.format(new Date(iso))} (hora de Costa Rica)`;

const DAY_FMT = new Intl.DateTimeFormat('es-CR', {
  timeZone: 'America/Costa_Rica',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const HOUR_FMT = new Intl.DateTimeFormat('es-CR', {
  timeZone: 'America/Costa_Rica',
  hour: 'numeric',
  minute: '2-digit',
});

/** The open times under their Costa Rica day, in the order the server sent them. */
function byDay(slots: string[]): [string, string[]][] {
  const days = new Map<string, string[]>();
  for (const slot of slots) {
    const day = DAY_FMT.format(new Date(slot));
    days.set(day, [...(days.get(day) ?? []), slot]);
  }
  return [...days];
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; ctx: HotelContext }
  | { kind: 'talking'; ctx: HotelContext }
  | { kind: 'closed'; ctx: HotelContext };

async function post(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/plw-hotel-demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(
      (body && typeof body['error'] === 'string' && body['error']) || 'No se pudo procesar la solicitud.'
    );
  }
  return body ?? {};
}

export function HotelDemoPage() {
  const { token = '' } = useParams();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [slots, setSlots] = useState<string[] | null>(null);
  const [booking, setBooking] = useState<SlotInfo | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [guestName, setGuestName] = useState('');
  const conversation = useRef<{ endSession: () => Promise<void> } | null>(null);

  const loadContext = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const ctx = (await post('context', { token })) as unknown as HotelContext;
      setPhase({ kind: 'ready', ctx });
      setBooking(ctx.booking ? { id: ctx.booking.id, slotStart: ctx.booking.slotStart } : null);
    } catch (cause) {
      setPhase({ kind: 'error', message: cause instanceof Error ? cause.message : 'Enlace no disponible.' });
    }
  }, [token]);

  useEffect(() => {
    void loadContext();
    return () => {
      if (conversation.current) void conversation.current.endSession().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadSlots = () => {
    post('slots', { token })
      .then((body) => setSlots((body['slots'] as string[]) ?? []))
      .catch(() => setSlots([]));
  };

  const startVoice = async () => {
    if (phase.kind !== 'ready' && phase.kind !== 'closed') return;
    const ctx = phase.ctx;
    // Consent first: the microphone is requested only after this explicit tap.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setBookingError(
        'Para hablar con la recepcionista, permita el micrófono (ícono del candado en la barra del navegador) y vuelva a intentarlo.'
      );
      return;
    }
    stream.getTracks().forEach((track) => track.stop());
    setBookingError(null);
    try {
      const body = await post('start', { token });
      const { Conversation } = await import('@elevenlabs/client');
      conversation.current = (await Conversation.startSession({
        conversationToken: body['conversationToken'] as string,
        connectionType: 'webrtc',
        dynamicVariables: (body['dynamicVariables'] ?? {}) as Record<string, string>,
        onDisconnect: () => {
          setPhase({ kind: 'closed', ctx });
          conversation.current = null;
        },
        onError: () => {
          setPhase({ kind: 'closed', ctx });
          conversation.current = null;
        },
      })) as unknown as { endSession: () => Promise<void> };
      setPhase({ kind: 'talking', ctx });
    } catch (cause) {
      setBookingError(cause instanceof Error ? cause.message : 'No se pudo iniciar la demostración.');
    }
  };

  const endVoice = () => {
    if (conversation.current) void conversation.current.endSession().catch(() => undefined);
    conversation.current = null;
    if (phase.kind === 'talking') setPhase({ kind: 'closed', ctx: phase.ctx });
  };

  const book = async (slot: string) => {
    setBookingBusy(true);
    setBookingError(null);
    try {
      const body = await post('book', {
        token,
        slotStart: slot,
        requestId: crypto.randomUUID(),
        guestName,
      });
      setBooking({
        id: String(body['booking_id'] ?? ''),
        slotStart: String(body['slot_start'] ?? slot),
      });
      setSlots(null);
    } catch (cause) {
      setBookingError(cause instanceof Error ? cause.message : 'No se pudo agendar.');
    } finally {
      setBookingBusy(false);
    }
  };

  const cancelBooking = async () => {
    if (!booking) return;
    setBookingBusy(true);
    try {
      await post('cancel', { token, bookingId: booking.id });
      setBooking(null);
    } catch (cause) {
      setBookingError(cause instanceof Error ? cause.message : 'No se pudo cancelar.');
    } finally {
      setBookingBusy(false);
    }
  };

  if (phase.kind === 'loading') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 bg-plw-ivory p-6">
        <p className="text-center text-sm text-neutral-500">Cargando su demostración…</p>
      </main>
    );
  }
  if (phase.kind === 'error') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 bg-plw-ivory p-6">
        <StatusMessage tone="error" title={phase.message} />
      </main>
    );
  }

  const ctx = phase.ctx;
  const talking = phase.kind === 'talking';

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 bg-plw-ivory p-5 pb-10">
      <header className="flex flex-col gap-1 pt-6 text-center">
        <p className="inline-flex items-center justify-center gap-1.5 self-center rounded-full border border-plw-gold/60 bg-white px-3 py-1 text-xs font-medium text-plw-navy">
          <Globe size={13} aria-hidden="true" />
          Demostración de PLW
        </p>
        <h1 className="text-2xl font-semibold leading-tight text-plw-ink">{ctx.businessName}</h1>
        {ctx.locale ? <p className="text-sm text-neutral-500">{ctx.locale}</p> : null}
      </header>

      <section
        aria-label="Recepcionista de demostración"
        className="rounded-2xl border border-neutral-200 bg-white p-4"
      >
        <div className="flex items-center gap-2">
          <PhoneCall size={18} className="text-plw-navy" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-plw-ink">
            Pruebe su recepcionista con inteligencia artificial
          </h2>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Atiende a cualquier hora. Háblele en español o en inglés: responde en el idioma que
          usted use. Es una demostración: <strong>ninguna conversación es real ni se registra</strong>.
        </p>

        <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          Pregunta de ejemplo: <em>“{ctx.exampleQuestion}”</em>
        </p>

        {talking ? (
          <div className="mt-3 grid gap-2">
            <p role="status" className="animate-pulse text-center text-sm font-medium text-plw-navy">
              La recepcionista está escuchando…
            </p>
            <Button variant="secondary" onClick={endVoice}>
              Terminar conversación
            </Button>
          </div>
        ) : (
          <Button className="mt-3 w-full" onClick={() => void startVoice()}>
            <Mic size={16} aria-hidden="true" />
            Hablar con la recepcionista
          </Button>
        )}
        {phase.kind === 'closed' ? (
          <p className="mt-2 text-center text-xs text-neutral-500">
            Gracias por probar la demostración. Para tenerla en su hotel, contáctenos al 4010-6198.
          </p>
        ) : null}
      </section>

      <section aria-label="Ejemplo de notificación" className="rounded-2xl border border-dashed border-neutral-300 bg-white/70 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-neutral-500" aria-hidden="true" />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Ejemplo de notificación a recepción (demo)
          </h2>
        </div>
        <p className="mt-2 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-700">
          “Huésped pregunta: <em>Can I check in after 9 tonight?</em> — Respuesta sugerida: su
          recepcionista confirma la hora con el sistema del hotel y avisa a recepción.”
        </p>
        <p className="mt-1 text-[11px] text-neutral-500">
          Claramente marcado como demostración: nada se envía ni se registra realmente.
        </p>
        {ctx.siteSampleToken ? (
          <a
            href={buildPreviewUrl(ctx.siteSampleToken)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-plw-navy underline underline-offset-4"
          >
            <Globe size={12} aria-hidden="true" />
            Ver el sitio de muestra del hotel
          </a>
        ) : null}
      </section>

      <section aria-label="Agendar 5 minutos con Alejandro" className="rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <CalendarCheck size={18} className="text-plw-navy" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-plw-ink">Agende 5 minutos con Alejandro</h2>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Una llamada breve para ver cómo quedaría en su hotel. Lunes a viernes, 8:00–16:00,
          hora de Costa Rica.
        </p>

        {booking ? (
          <div className="mt-3 grid gap-2 rounded-xl border border-success-200 bg-success-50 p-3">
            <p className="text-sm font-medium text-success-700">
              <CalendarClock size={14} className="mr-1 inline" aria-hidden="true" />
              Su cita: {crLabel(booking.slotStart)}
            </p>
            <p className="text-xs text-success-700">
              Alejandro lo llamará a esa hora al teléfono del hotel.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="justify-self-start"
              disabled={bookingBusy}
              onClick={() => void cancelBooking()}
            >
              {bookingBusy ? 'Cancelando…' : 'Cancelar o cambiar la cita'}
            </Button>
          </div>
        ) : slots === null ? (
          <Button className="mt-3 w-full" variant="secondary" onClick={loadSlots}>
            <CalendarClock size={16} aria-hidden="true" />
            Ver horarios disponibles
          </Button>
        ) : (
          <div className="mt-3">
            <label htmlFor="guest-name" className="text-xs font-medium text-neutral-600">
              Su nombre (opcional)
            </label>
            <input
              id="guest-name"
              value={guestName}
              maxLength={120}
              onChange={(event) => setGuestName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-plw-ink"
            />
            <p className="mt-3 text-xs font-medium text-neutral-600">Horarios disponibles:</p>
            {slots.length === 0 ? (
              <p className="mt-1 text-sm text-neutral-500">
                No hay horarios abiertos por ahora. Llame al 4010-6198.
              </p>
            ) : (
              byDay(slots).map(([day, times]) => (
                <div key={day} className="mt-3">
                  <h3 className="text-xs font-semibold capitalize text-plw-ink">{day}</h3>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    {times.map((slot) => (
                      <Button
                        key={slot}
                        size="sm"
                        variant="secondary"
                        disabled={bookingBusy}
                        onClick={() => void book(slot)}
                      >
                        {HOUR_FMT.format(new Date(slot))}
                      </Button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
        {bookingError ? (
          <p role="alert" className="mt-2 text-xs font-medium text-danger-700">
            {bookingError}
          </p>
        ) : null}
      </section>

      <footer className="mt-auto pt-4 text-center text-[11px] text-neutral-400">
        Professional Latino Workers · 4010-6198 · Demostración sin costo ni compromiso.
      </footer>
    </main>
  );
}
