// Public hotel demo: context, voice session, and 5-minute booking, keyed by the opaque
// link token. Everything here is public-by-design: business name, locale, services, faqs
// and the site-draft token come from prospect_site_drafts (the same public fields the
// secretary preview already exposes). No phone, email, notes or agent data ever leaves.
//
// Actions (JSON POST):
//   { action: 'context', token }                     -> page boot: name, languages, notice, site sample
//   { action: 'start', token, language }             -> one-conversation ElevenLabs token + variables
//   { action: 'slots', token }                       -> the next open bookable slots
//   { action: 'book', token, slotStart, requestId, guestName?, guestNote? }
//   { action: 'cancel', token, bookingId }
//   { action: 'myBooking', token }                   -> the hotel's own active booking, if any

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  allowedOrigin,
  corsPreflight,
  json,
  normalizeToken,
  rateKey,
  windowBucket,
} from './rules.ts';

// The live receptionist demo reuses the proven secretary demo agent: same quota, same
// signed one-conversation token, same ES/EN handling. Nothing is duplicated here.
const SECRETARY_FUNCTION_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/plw-secretary-converse`;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Minute-bucket limits per link token. Generating 5-minute slots is cheap; voice and
// booking are the protected surfaces.
const RATE_LIMITS: Record<string, number> = { context: 20, slots: 20, book: 6, cancel: 6, start: 10, myBooking: 20 };

const DEMO_NOTICE =
  'Recepcionista de demostración de Professional Latino Workers (PLW): conversaciones de '
  + 'hasta 5 minutos. Nada de lo que diga se registra en un sistema real.';

type Db = ReturnType<typeof createClient>;
const serviceDb = (): Db =>
  createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function rateLimited(db: Db, key: string, limit: number): Promise<boolean> {
  const bucket = windowBucket();
  const { data: hit } = await db
    .from('plw_voice_rate')
    .select('hit_count')
    .match({ rate_key: key, window_bucket: bucket })
    .maybeSingle();
  const count = hit?.hit_count ?? 0;
  if (count >= limit) return true;
  await db
    .from('plw_voice_rate')
    .upsert({ rate_key: key, window_bucket: bucket, hit_count: count + 1 }, { onConflict: 'rate_key,window_bucket' });
  return false;
}

interface LinkRow {
  id: string;
  token: string;
  prospect_id: string;
  revoked_at: string | null;
}

async function loadLink(db: Db, rawToken: unknown): Promise<LinkRow | null> {
  const token = normalizeToken(rawToken);
  if (!token) return null;
  const { data } = await db
    .from('tourism_hotel_demo_links')
    .select('id, token, prospect_id, revoked_at')
    .eq('token', token)
    .maybeSingle();
  return data && !data.revoked_at ? (data as LinkRow) : null;
}

/** Public draft fields for the receptionist context (same set the secretary preview shows). */
async function loadContext(db: Db, link: LinkRow) {
  const { data: draft } = await db
    .from('prospect_site_drafts')
    .select('business_name, locale, category, services, highlight, description, faqs, facts, secretary_name, secretary_type, preview_token')
    .eq('prospect_id', link.prospect_id)
    .maybeSingle();
  const { data: booking } = await db
    .from('tourism_demo_bookings')
    .select('id, slot_start, status, guest_name')
    .eq('link_id', link.id)
    .eq('status', 'booked')
    .maybeSingle();
  return { draft: draft ?? null, booking: booking ?? null };
}

/** Next open slots: the next 14 days, Mon-Fri 08:00-16:00 CR on 5-minute steps, minus taken. */
function candidateSlots(taken: Set<number>, now: Date): string[] {
  const out: string[] = [];
  const step = 5 * 60 * 1000;
  // 08:00 CR == 14:00 UTC (no DST in Costa Rica).
  for (let day = 0; day < 15 && out.length < 60; day += 1) {
    const dayUtc = new Date(now.getTime() + day * 24 * 60 * 60 * 1000);
    dayUtc.setUTCHours(14, 0, 0, 0);
    const weekday = dayUtc.getUTCDay(); // 0 Sun ... 6 Sat
    if (weekday === 0 || weekday === 6) continue;
    for (let minutes = 0; minutes < 8 * 60 && out.length < 60; minutes += 5) {
      const slot = new Date(dayUtc.getTime() + minutes * 60 * 1000);
      if (slot.getTime() <= now.getTime() + 60 * 60 * 1000) continue;
      if (taken.has(slot.getTime())) continue;
      out.push(slot.toISOString());
    }
  }
  return out;
}

async function slotsAction(db: Db, link: LinkRow, origin: string): Promise<Response> {
  const { data } = await db
    .from('tourism_demo_bookings')
    .select('slot_start')
    .eq('agent_id', 'agent-2')
    .eq('status', 'booked')
    .gte('slot_start', new Date().toISOString())
    .order('slot_start', { ascending: true })
    .limit(500);
  const taken = new Set(
    ((data ?? []) as { slot_start: string }[]).map((row) => Date.parse(row.slot_start))
  );
  return json({ slots: candidateSlots(taken, new Date()) }, 200, origin);
}

/** Forwards the live conversation start to the proven plw-secretary-converse function,
 *  keyed by the draft's preview token (what that function's quota and agent know). */
async function startAction(db: Db, link: LinkRow, origin: string): Promise<Response> {
  const { data: draft } = await db
    .from('prospect_site_drafts')
    .select('preview_token')
    .eq('prospect_id', link.prospect_id)
    .maybeSingle();
  if (!draft?.preview_token) {
    return json({ error: 'La recepcionista no está disponible todavía. Pida su enlace al equipo PLW.' }, 404, origin);
  }
  const response = await fetch(SECRETARY_FUNCTION_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start', token: draft.preview_token }),
    signal: AbortSignal.timeout(25000),
  }).catch(() => null);
  if (!response || !response.ok) {
    const status = response?.status === 429 ? 429 : 503;
    return json(
      { error: 'La recepcionista no está disponible en este momento. Intente en un momento.' },
      status,
      origin
    );
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || payload.allowed !== true || typeof payload.conversationToken !== 'string') {
    return json(
      { error: 'La demostración ya usó sus conversaciones. Contáctenos al 4010-6198.' },
      503,
      origin
    );
  }
  return json(
    {
      conversationToken: payload.conversationToken,
      dynamicVariables: payload.dynamicVariables ?? {},
      notice: payload.notice ?? DEMO_NOTICE,
      closing: payload.closing ?? null,
    },
    200,
    origin
  );
}

Deno.serve(async (req) => {
  const origin = allowedOrigin(req);
  if (req.method === 'OPTIONS') return corsPreflight(req);
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405, origin);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.['action'] === 'string' ? body['action'] : '';
  const limit = RATE_LIMITS[action];
  if (!limit) return json({ error: 'Solicitud no válida.' }, 400, origin);

  const db = serviceDb();
  const link = await loadLink(db, body?.['token']);
  if (!link) return json({ error: 'Enlace no disponible.' }, 404, origin);
  if (await rateLimited(db, rateKey(`hotel:${action}`, link.token), limit)) {
    return json({ error: 'Demasiadas solicitudes. Intente en un momento.' }, 429, origin);
  }

  try {
    if (action === 'context') {
      const { draft, booking } = await loadContext(db, link);
      const { data: siteUrl } = await db
        .from('prospect_site_drafts')
        .select('preview_token')
        .eq('prospect_id', link.prospect_id)
        .maybeSingle();
      return json(
        {
          businessName: draft?.business_name ?? '',
          locale: draft?.locale ?? '',
          languages: ['es', 'en'],
          notice: DEMO_NOTICE,
          exampleQuestion: 'Can I check in after 9 tonight?',
          siteSampleToken: siteUrl?.preview_token ?? draft?.preview_token ?? null,
          booking: booking
            ? { id: booking.id, slotStart: booking.slot_start, guestName: booking.guest_name }
            : null,
        },
        200,
        origin
      );
    }

    if (action === 'slots') return await slotsAction(db, link, origin);

    if (action === 'myBooking') {
      const { data: booking } = await db
        .from('tourism_demo_bookings')
        .select('id, slot_start, guest_name, guest_note')
        .eq('link_id', link.id)
        .eq('status', 'booked')
        .maybeSingle();
      return json(
        { booking: booking ? { id: booking.id, slotStart: booking.slot_start, guestName: booking.guest_name, guestNote: booking.guest_note } : null },
        200,
        origin
      );
    }

    if (action === 'start') return await startAction(db, link, origin);

    if (action === 'book') {
      const slotStart = typeof body['slotStart'] === 'string' ? body['slotStart'] : '';
      const requestId = typeof body['requestId'] === 'string' ? body['requestId'] : '';
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?$/.test(slotStart)) {
        return json({ error: 'Horario no válido.' }, 400, origin);
      }
      if (!/^[A-Za-z0-9._:-]{8,100}$/.test(requestId)) {
        return json({ error: 'Solicitud no válida.' }, 400, origin);
      }
      const parsed = new Date(slotStart);
      if (Number.isNaN(parsed.getTime())) return json({ error: 'Horario no válido.' }, 400, origin);
      const { data, error } = await db.rpc('book_tourism_demo_from_link', {
        p_token: link.token,
        p_slot_start: parsed.toISOString(),
        p_idempotency_key: `link:${link.id}:${requestId}`,
        p_guest_name: typeof body['guestName'] === 'string' ? body['guestName'] : '',
        p_guest_note: typeof body['guestNote'] === 'string' ? body['guestNote'] : '',
      });
      if (error) {
        const conflict = error.code === '23P01';
        return json(
          { error: conflict ? 'Ese horario acaba de ocuparse. Elija otro, por favor.' : error.message },
          conflict ? 409 : 400,
          origin
        );
      }
      return json(data, 200, origin);
    }

    if (action === 'cancel') {
      const bookingId = typeof body['bookingId'] === 'string' ? body['bookingId'] : '';
      if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return json({ error: 'Reserva no válida.' }, 400, origin);
      const { error } = await db.rpc('cancel_tourism_demo_booking', {
        p_token: link.token,
        p_booking_id: bookingId,
      });
      if (error) return json({ error: 'No se pudo cancelar la reserva.' }, 400, origin);
      return json({ ok: true }, 200, origin);
    }

    return json({ error: 'Solicitud no válida.' }, 400, origin);
  } catch (cause) {
    console.error('plw-hotel-demo', cause);
    return json({ error: 'No se pudo procesar la solicitud.' }, 500, origin);
  }
});
