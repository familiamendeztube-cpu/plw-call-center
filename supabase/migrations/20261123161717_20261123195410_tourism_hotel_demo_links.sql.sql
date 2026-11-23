/*
# Hotel demo share links + public 5-minute booking with Alejandro

1. Purpose
   One mobile-friendly public link per hotel (tourism prospect). The page lets the owner try
   the two-way ElevenLabs receptionist in Spanish or English (the same live demo agent used by
   the Secretaria IA preview, keyed by the existing site-draft preview token) and book five
   minutes with Alejandro on that same page. The agreed slot appears exactly once in the
   existing "Demo agendada" milestone and on the agent's agenda.

2. New Tables
   - `tourism_hotel_demo_links`
     - `id` (uuid, pk)
     - `prospect_id` (uuid, unique, -> prospects CASCADE): strictly one link per hotel.
     - `token` (text, unique, 48 hex): opaque public key, generated with gen_random_bytes.
     - `context_source` (text, fixed 'site_draft'): the receptionist context reuses the
       prospect's site-draft draft (public fields only: name, services, faqs). No private
       prospect data is ever returned by the public endpoints.
     - `created_by` (text, -> staff_profiles), `created_at`, `revoked_at` (null while active).
     - `note` (text, free internal label of who the link was handed to).
   - `tourism_demo_bookings`
     - `id` (uuid, pk), `link_id` (-> links CASCADE), `prospect_id` (-> prospects CASCADE).
     - `slot_start` (timestamptz): the agreed Costa Rica time.
     - `slot_end` (timestamptz): slot_start + 5 minutes (database-computed).
     - `status` (text: 'booked' | 'cancelled'), `booked_by` ('owner' | 'agent'),
       `agent_id` (text): Alejandro (agent-2) or the booking staff member.
     - `idempotency_key` (text, unique): replaying the same request never duplicates a booking.
     - `guest_name`, `guest_note` (optional public text typed by the hotel owner).
     - `created_at`, `updated_at`.
     - One active booking per link: unique index on link_id WHERE status='booked'.
     - Collision safety: unique index on agent_id, slot_start WHERE status='booked' — the
       same Alejandro slot can never be double-booked, whichever surface books it.

3. New Functions (all SECURITY DEFINER, search_path pinned)
   - `ensure_tourism_hotel_demo_link(p_prospect_id)`: staff (owner or admin). Creates the
     link once (idempotent); if the site draft does not exist yet it creates a minimal draft
     row so the receptionist context comes from somewhere. Returns the row.
   - `rotate_tourism_hotel_demo_token(p_prospect_id)`: staff. New token, same link row.
   - `book_tourism_demo_from_link(p_token, p_slot_start, p_idempotency_key, p_guest_name, p_guest_note)`:
     PUBLIC callable. Validates the token, rejects revoked/missing links, validates the slot
     (whole 5 minutes, inside Mon–Fri 08:00–16:00 Costa Rica, not in the past, at most 30 days
     out). Idempotent by key. Advisory-locked per (agent,slot) then re-checks collisions and
     inserts; on success adds the 'demo_agendada' milestone (due_at = slot, ON CONFLICT DO
     NOTHING, never duplicates) and one activity event.
   - `cancel_tourism_demo_booking(p_token, p_booking_id)`: PUBLIC callable. The link holder
     may cancel their own active booking (status change only; the milestone row is kept with
     its history — a reschedule by the hotel just books another slot).
   - `book_tourism_demo_as_staff(p_prospect_id, p_slot_start)`: staff (owner or admin), for
     the agent-side "preparar la demo" booking; same slot validation/collision rules; records
     the milestone the same way. Slots already taken show an error, never overwrite.

4. Security
   - RLS enabled on both tables; no table grants to anon/authenticated at all — the public
     endpoints go through the edge function (service_role) and the staff RPCs, so no browser
     can read link tokens or booking rows directly. No prospect private data is exposed.
   - `ensure/rotate/book_as_staff` EXECUTE to authenticated only; the two public functions to
     anon + authenticated (they are the only public surface, token-scoped, write-minimal).
   - Slot window mirrors the campaign gate (Mon–Fri 08:00–16:00 CR) so the demo is booked
     inside the hours the team actually works.
*/

CREATE TABLE IF NOT EXISTS public.tourism_hotel_demo_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL UNIQUE REFERENCES public.prospects(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{48}$'),
  context_source text NOT NULL DEFAULT 'site_draft' CHECK (context_source = 'site_draft'),
  created_by text REFERENCES public.staff_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 300)
);

CREATE TABLE IF NOT EXISTS public.tourism_demo_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.tourism_hotel_demo_links(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled')),
  booked_by text NOT NULL CHECK (booked_by IN ('owner','agent')),
  agent_id text REFERENCES public.staff_profiles(id),
  idempotency_key text NOT NULL UNIQUE,
  guest_name text NOT NULL DEFAULT '' CHECK (char_length(guest_name) <= 120),
  guest_note text NOT NULL DEFAULT '' CHECK (char_length(guest_note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (slot_end > slot_start AND slot_end - slot_start <= interval '15 minutes')
);

CREATE INDEX IF NOT EXISTS tourism_demo_bookings_slot_idx
  ON public.tourism_demo_bookings (slot_start) WHERE status = 'booked';
CREATE UNIQUE INDEX IF NOT EXISTS tourism_demo_bookings_link_active_uidx
  ON public.tourism_demo_bookings (link_id) WHERE status = 'booked';
-- Alejandro is one person: the same slot can never hold two demos, from any surface.
CREATE UNIQUE INDEX IF NOT EXISTS tourism_demo_bookings_agent_slot_uidx
  ON public.tourism_demo_bookings (agent_id, slot_start) WHERE status = 'booked';

ALTER TABLE public.tourism_hotel_demo_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tourism_demo_bookings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tourism_hotel_demo_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.tourism_demo_bookings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tourism_hotel_demo_links TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.tourism_demo_bookings TO service_role;

-- Slot validation shared by both booking paths: whole 5 minutes, Mon–Fri 08:00–16:00 CR,
-- not in the past, at most 30 days out.
CREATE OR REPLACE FUNCTION public.tourism_demo_slot_ok(p_slot timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH cr AS (
    SELECT (p_slot AT TIME ZONE 'America/Costa_Rica') AS local_ts
  ), bounds AS (
    SELECT (date_trunc('day', local_ts) + make_interval(hours => 8)) AS day_start,
           (date_trunc('day', local_ts) + make_interval(hours => 16)) AS day_end
    FROM cr
  )
  SELECT EXISTS (
    SELECT 1 FROM cr, bounds
    WHERE p_slot = date_trunc('minutes', p_slot)
      AND EXTRACT(MINUTE FROM p_slot) % 5 = 0
      AND cr.local_ts >= bounds.day_start
      AND cr.local_ts < bounds.day_end
      AND EXTRACT(ISODOW FROM cr.local_ts) < 6
      AND p_slot > now() + interval '1 hour'
      AND p_slot < now() + interval '30 days'
  )
$$;
REVOKE ALL ON FUNCTION public.tourism_demo_slot_ok(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tourism_demo_slot_ok(timestamptz) TO service_role;

-- Staff side: one link per prospect, reused; creates a minimal site draft if none exists.
CREATE OR REPLACE FUNCTION public.ensure_tourism_hotel_demo_link(p_prospect_id uuid)
RETURNS public.tourism_hotel_demo_links
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_staff text := public.current_staff_id();
  v_link public.tourism_hotel_demo_links;
BEGIN
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Solo el personal puede generar el enlace.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'Solo el agente asignado o administración.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.prospect_site_drafts (prospect_id, site_slug, business_name, locale, category)
  SELECT p_prospect_id, 'plw-tourism-stays', p.business_name, '', 'lodging'
  FROM public.prospects p
  WHERE p.id = p_prospect_id
  ON CONFLICT (prospect_id) DO NOTHING;

  INSERT INTO public.tourism_hotel_demo_links (prospect_id, token, created_by, note)
  VALUES (p_prospect_id, encode(gen_random_bytes(24), 'hex'), v_staff, '')
  ON CONFLICT (prospect_id) DO UPDATE SET prospect_id = EXCLUDED.prospect_id
  RETURNING * INTO v_link;
  RETURN v_link;
END $$;

CREATE OR REPLACE FUNCTION public.rotate_tourism_hotel_demo_token(p_prospect_id uuid)
RETURNS public.tourism_hotel_demo_links
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_link public.tourism_hotel_demo_links;
BEGIN
  SELECT * INTO v_link FROM public.tourism_hotel_demo_links WHERE prospect_id = p_prospect_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El enlace todavía no existe.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'Solo el agente asignado o administración.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tourism_hotel_demo_links
  SET token = encode(gen_random_bytes(24), 'hex'), revoked_at = NULL
  WHERE id = v_link.id
  RETURNING * INTO v_link;
  RETURN v_link;
END $$;

REVOKE ALL ON FUNCTION public.ensure_tourism_hotel_demo_link(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rotate_tourism_hotel_demo_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_tourism_hotel_demo_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_tourism_hotel_demo_token(uuid) TO authenticated;

-- Public booking from the link. Writes only what the hotel owner types; the slot is
-- collision-checked under an advisory lock so two tabs can never take the same time.
CREATE OR REPLACE FUNCTION public.book_tourism_demo_from_link(
  p_token text, p_slot_start timestamptz, p_idempotency_key text,
  p_guest_name text DEFAULT '', p_guest_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_link public.tourism_hotel_demo_links;
  v_existing public.tourism_demo_bookings;
  v_booking public.tourism_demo_bookings;
BEGIN
  IF p_token IS NULL OR p_token !~ '^(plw-)?[0-9a-f]{48}$' THEN
    RAISE EXCEPTION 'Solicitud no válida.' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) > 100
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'Solicitud no válida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_link FROM public.tourism_hotel_demo_links
  WHERE token = ltrim(p_token, 'plw-') AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enlace no disponible.' USING ERRCODE = 'P0002'; END IF;

  -- Idempotency: the same key returns the same booking, whatever its state.
  SELECT * INTO v_existing FROM public.tourism_demo_bookings
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'booking_id', v_existing.id, 'slot_start', v_existing.slot_start,
      'status', v_existing.status, 'duplicate', true
    );
  END IF;

  IF NOT public.tourism_demo_slot_ok(p_slot_start) THEN
    RAISE EXCEPTION 'Horario no disponible: elija un día de semana entre 8:00 y 16:00, hora de Costa Rica.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('tourism-demo:' || v_link.agent_default_slot_key(p_slot_start)::text));

  -- Re-check under the lock: another tab may have taken the slot meanwhile.
  IF EXISTS (
    SELECT 1 FROM public.tourism_demo_bookings
    WHERE agent_id = 'agent-2' AND slot_start = p_slot_start AND status = 'booked'
  ) THEN
    RAISE EXCEPTION 'Ese horario acaba de ocuparse. Elija otro, por favor.' USING ERRCODE = '23P01';
  END IF;

  -- One active booking per link: replacing it (reschedule) cancels the previous row.
  UPDATE public.tourism_demo_bookings
  SET status = 'cancelled', updated_at = now()
  WHERE link_id = v_link.id AND status = 'booked';

  INSERT INTO public.tourism_demo_bookings
    (link_id, prospect_id, slot_start, slot_end, status, booked_by, agent_id,
     idempotency_key, guest_name, guest_note)
  VALUES
    (v_link.id, v_link.prospect_id, p_slot_start, p_slot_start + interval '5 minutes',
     'booked', 'owner', 'agent-2', p_idempotency_key,
     left(btrim(COALESCE(p_guest_name, '')), 120), left(btrim(COALESCE(p_guest_note, '')), 500))
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_booking;

  IF v_booking IS NULL THEN
    -- Lost a race against the same idempotency key; return the winner.
    SELECT * INTO v_existing FROM public.tourism_demo_bookings WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('booking_id', v_existing.id, 'slot_start', v_existing.slot_start,
      'status', v_existing.status, 'duplicate', true);
  END IF;

  -- The agreed slot appears exactly once in the existing milestone (its upsert keeps history).
  INSERT INTO public.tourism_milestones (prospect_id, milestone, channel, source, agent_id, due_at, slot_confirmed)
  VALUES (v_link.prospect_id, 'demo_agendada', '', 'auto', 'agent-2', p_slot_start, true)
  ON CONFLICT (prospect_id, milestone) DO NOTHING;

  INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
  VALUES ('agent-2', v_link.prospect_id, 'note',
    'Demo agendada desde el enlace del hotel para el '
    || to_char(p_slot_start AT TIME ZONE 'America/Costa_Rica', 'DD/MM HH12:MI AM') || ' (Costa Rica).');

  RETURN jsonb_build_object('booking_id', v_booking.id, 'slot_start', v_booking.slot_start,
    'status', v_booking.status, 'duplicate', false);
END $$;

-- The hotel owner may cancel their own active booking from the same link.
CREATE OR REPLACE FUNCTION public.cancel_tourism_demo_booking(p_token text, p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_link public.tourism_hotel_demo_links;
BEGIN
  IF p_token IS NULL OR p_token !~ '^(plw-)?[0-9a-f]{48}$' THEN
    RAISE EXCEPTION 'Solicitud no válida.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_link FROM public.tourism_hotel_demo_links
  WHERE token = ltrim(p_token, 'plw-') AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enlace no disponible.' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.tourism_demo_bookings
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_booking_id AND link_id = v_link.id AND status = 'booked';
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva no encontrada.' USING ERRCODE = 'P0002'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.book_tourism_demo_from_link(text, timestamptz, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_tourism_demo_from_link(text, timestamptz, text, text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_tourism_demo_booking(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_tourism_demo_booking(text, uuid) TO anon, authenticated;

-- Agent-side booking ("preparar la demo" with the hotel on the phone): same slot rules.
CREATE OR REPLACE FUNCTION public.book_tourism_demo_as_staff(p_prospect_id uuid, p_slot_start timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_staff text := public.current_staff_id();
  v_booking_id uuid;
BEGIN
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Solo el personal puede agendar.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'Solo el agente asignado o administración.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tourism_demo_slot_ok(p_slot_start) THEN
    RAISE EXCEPTION 'Horario no disponible: elija un día de semana entre 8:00 y 16:00, hora de Costa Rica.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('tourism-demo:agent-2:' || p_slot_start::text));
  IF EXISTS (
    SELECT 1 FROM public.tourism_demo_bookings
    WHERE agent_id = 'agent-2' AND slot_start = p_slot_start AND status = 'booked'
  ) THEN
    RAISE EXCEPTION 'Ese horario ya está reservado. Elija otro.' USING ERRCODE = '23P01';
  END IF;

  INSERT INTO public.tourism_demo_bookings
    (link_id, prospect_id, slot_start, slot_end, status, booked_by, agent_id, idempotency_key, guest_name, guest_note)
  SELECT l.id, l.prospect_id, p_slot_start, p_slot_start + interval '5 minutes', 'booked', 'agent', v_staff,
         'staff:' || p_prospect_id::text || ':' || EXTRACT(EPOCH FROM p_slot_start)::bigint, '', ''
  FROM public.tourism_hotel_demo_links l
  WHERE l.prospect_id = p_prospect_id
  ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_booking_id;

  IF v_booking_id IS NULL THEN
    -- No link yet: create one implicitly so the booking always has its home.
    PERFORM public.ensure_tourism_hotel_demo_link(p_prospect_id);
    INSERT INTO public.tourism_demo_bookings
      (link_id, prospect_id, slot_start, slot_end, status, booked_by, agent_id, idempotency_key, guest_name, guest_note)
    SELECT l.id, l.prospect_id, p_slot_start, p_slot_start + interval '5 minutes', 'booked', 'agent', v_staff,
           'staff:' || p_prospect_id::text || ':' || EXTRACT(EPOCH FROM p_slot_start)::bigint, '', ''
    FROM public.tourism_hotel_demo_links l
    WHERE l.prospect_id = p_prospect_id
    ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_booking_id;
  END IF;

  INSERT INTO public.tourism_milestones (prospect_id, milestone, channel, source, agent_id, due_at, slot_confirmed)
  VALUES (p_prospect_id, 'demo_agendada', '', 'manual', v_staff, p_slot_start, true)
  ON CONFLICT (prospect_id, milestone) DO NOTHING;

  INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
  VALUES (v_staff, p_prospect_id, 'note',
    'Demo agendada para el '
    || to_char(p_slot_start AT TIME ZONE 'America/Costa_Rica', 'DD/MM HH12:MI AM') || ' (Costa Rica).');

  RETURN v_booking_id;
END $$;
REVOKE ALL ON FUNCTION public.book_tourism_demo_as_staff(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_tourism_demo_as_staff(uuid, timestamptz) TO authenticated;
