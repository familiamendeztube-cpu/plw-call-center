import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarClock, ExternalLink, Link2, Mail, MessageCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { costaRicaLocalInputToIso } from '@/app/dates';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { PUBLIC_APP_BASE } from '@/features/site-draft/models/siteDraft';

/**
 * One public demo link per hotel. The page (mobile) lets the owner try the two-way
 * ElevenLabs receptionist in Spanish or English and book five minutes with Alejandro on
 * the same page. The agent generates it, copies or shares it through the approved
 * composer, and can also book the demo themselves while on the phone.
 */

interface LinkRow {
  token: string;
  revoked_at: string | null;
}

interface Props {
  prospectId: string;
  prospectName: string;
  phone: string;
  email: string;
  /** Signed-in agent only; administrators see the card read-only. */
  canBook: boolean;
}

const crTime = (iso: string) =>
  new Date(iso).toLocaleString('es-CR', {
    timeZone: 'America/Costa_Rica',
    dateStyle: 'short',
    timeStyle: 'short',
  });

export function HotelDemoLinkCard({ prospectId, prospectName, phone, email, canBook }: Props) {
  const [link, setLink] = useState<LinkRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState('');
  const [bookedSlot, setBookedSlot] = useState<string | null>(null);
  const [shared, setShared] = useState<string | null>(null);

  const load = useCallback(() => {
    // Through the RPC: browsers have no grant on the links table itself.
    getSupabaseClient()
      .rpc('get_tourism_hotel_demo_link', { p_prospect_id: prospectId })
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (loadError) setError('No se pudo cargar el enlace de demostración.');
        else {
          setError(null);
          setLink((data as unknown as LinkRow) ?? null);
        }
        setLoading(false);
      });
  }, [prospectId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await getSupabaseClient().rpc('ensure_tourism_hotel_demo_link', {
        p_prospect_id: prospectId,
      });
      if (rpcError || !data) throw new Error(rpcError?.message || 'No se pudo crear el enlace.');
      setLink(data as unknown as LinkRow);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el enlace.');
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await getSupabaseClient().rpc('rotate_tourism_hotel_demo_token', {
        p_prospect_id: prospectId,
      });
      if (rpcError || !data) throw new Error(rpcError?.message || 'No se pudo renovar el enlace.');
      setLink(data as unknown as LinkRow);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo renovar el enlace.');
    } finally {
      setBusy(false);
    }
  };

  const publicUrl = link ? `${PUBLIC_APP_BASE}/demo-hotel/plw-${link.token}` : '';

  const share = (channel: 'email' | 'whatsapp') => {
    const text =
      `Le preparé una recepcionista de demostración para ${prospectName}. ` +
      `Puede probarla (en español o inglés) y agendar 5 minutos conmigo en el mismo enlace: ${publicUrl}`;
    if (channel === 'email' && email) {
      window.location.href = `mailto:${email}?subject=${encodeURIComponent(
        `Recepcionista de demostración — ${prospectName}`
      )}&body=${encodeURIComponent(text)}`;
    } else {
      const digits = phone.replace(/[^0-9]/g, '');
      window.open(
        `https://wa.me/${digits.length === 8 ? `506${digits}` : digits}?text=${encodeURIComponent(text)}`,
        '_blank',
        'noopener'
      );
    }
    setShared(channel);
  };

  const bookSlot = async (event: FormEvent) => {
    event.preventDefault();
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await getSupabaseClient().rpc('book_tourism_demo_as_staff', {
        p_prospect_id: prospectId,
        p_slot_start: costaRicaLocalInputToIso(slot),
      });
      if (rpcError) throw new Error(rpcError.message || 'No se pudo agendar la demo.');
      setBookedSlot(costaRicaLocalInputToIso(slot));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo agendar la demo.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section aria-label="Enlace de demostración del hotel" className="rounded-xl border border-neutral-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-plw-ink">Enlace de demostración del hotel</h3>
        <p className="mt-1 text-xs text-neutral-500">Cargando…</p>
      </section>
    );
  }

  return (
    <section aria-label="Enlace de demostración del hotel" className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 size={16} className="text-plw-navy" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-plw-ink">Enlace de demostración del hotel</h3>
        {canBook && !link ? (
          <Button size="sm" className="ml-auto" disabled={busy} onClick={create}>
            Generar enlace
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        Un enlace público por hotel: prueban la recepcionista (español o inglés) y agendan 5
        minutos con Alejandro en la misma página, sin escribir datos de nuevo.
      </p>
      {error ? <StatusMessage tone="error" title={error} /> : null}

      {link ? (
        <div className="mt-3 grid gap-2 text-sm">
          <p className="break-all text-plw-ink">
            <a
              href={`/demo-hotel/plw-${link.token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-plw-navy underline underline-offset-4"
            >
              Abrir la página de demo
              <ExternalLink size={13} aria-hidden="true" />
            </a>
            <CopyButton value={publicUrl} label="Copiar el enlace de demostración" />
          </p>
          {canBook ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => share('whatsapp')}>
                <MessageCircle size={14} aria-hidden="true" />
                Compartir por WhatsApp
              </Button>
              <Button size="sm" variant="secondary" onClick={() => share('email')} disabled={!email}>
                <Mail size={14} aria-hidden="true" />
                Compartir por correo
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={rotate}>
                <RotateCcw size={14} aria-hidden="true" />
                Renovar enlace
              </Button>
            </div>
          ) : null}
          {shared ? (
            <p className="text-xs text-neutral-500">
              ¿Ya lo envió por {shared === 'email' ? 'correo' : 'WhatsApp'}? El enlace sigue
              funcionando; el horario agendado aparece arriba y en la agenda.
            </p>
          ) : null}
        </div>
      ) : null}

      {canBook ? (
        <form className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3" onSubmit={bookSlot}>
          <label htmlFor="hotel-demo-slot" className="text-xs font-medium text-neutral-600">
            Preparar la demo con el hotel en línea:
          </label>
          <input
            id="hotel-demo-slot"
            type="datetime-local"
            required
            value={slot}
            onChange={(event) => setSlot(event.target.value)}
            className="rounded-lg border border-neutral-300 px-2 py-1 text-xs text-plw-ink"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !slot}>
            <CalendarClock size={14} aria-hidden="true" />
            {busy ? 'Agendando…' : 'Agendar demo'}
          </Button>
          {bookedSlot ? (
            <p className="basis-full text-xs font-medium text-success-700">
              Demo agendada para el {crTime(bookedSlot)} (hora de Costa Rica). Aparece en Hitos y
              en su agenda.
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
