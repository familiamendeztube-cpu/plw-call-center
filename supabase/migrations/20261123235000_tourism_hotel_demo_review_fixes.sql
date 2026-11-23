/*
# Hotel demo review fixes (2026-11-23)

1. get_tourism_hotel_demo_link: the agent's link card read tourism_hotel_demo_links
   directly, but browsers have no grant on that table by design, so the card always
   failed to load. This read-only RPC returns the link only to the assigned agent or
   an administrator (can_access_prospect), keeping the table closed.
2. book_tourism_demo_as_staff: an agent booking for a hotel that already had a demo hit
   the one-active-booking-per-link index with a raw 23505. The agent's new time now
   replaces the hotel's previous one (same as the public link does); the same time
   again is a no-op, and a time booked again after a cancellation is revived.
3. cancel_tourism_demo_booking: a hotel cancellation left "Demo agendada" at the
   cancelled time and told nobody. It now removes that milestone (only when it still
   points at the cancelled slot) and records it in the customer's activity.
4. set_payment_status: the weekly funnel's "Inicios pagados" counts recorded payment
   confirmations, but marking a customer paid never recorded one. Moving to 'paid'
   now writes one "Pago confirmado" activity event for the owning agent.
*/

CREATE OR REPLACE FUNCTION public.get_tourism_hotel_demo_link(p_prospect_id uuid)
RETURNS TABLE (token text, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.token, l.revoked_at
  FROM public.tourism_hotel_demo_links l
  WHERE l.prospect_id = p_prospect_id AND public.can_access_prospect(p_prospect_id)
$$;
REVOKE ALL ON FUNCTION public.get_tourism_hotel_demo_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tourism_hotel_demo_link(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.book_tourism_demo_as_staff(p_prospect_id uuid, p_slot_start timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_staff text := public.current_staff_id();
  v_link public.tourism_hotel_demo_links;
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

  -- Every booking hangs off the hotel's link; the first agent booking creates it.
  v_link := public.ensure_tourism_hotel_demo_link(p_prospect_id);

  PERFORM pg_advisory_xact_lock(hashtext('tourism-demo:agent-2:' || p_slot_start::text));

  -- The hotel already holds exactly this time: nothing to change.
  SELECT id INTO v_booking_id FROM public.tourism_demo_bookings
  WHERE link_id = v_link.id AND status = 'booked' AND slot_start = p_slot_start;
  IF FOUND THEN RETURN v_booking_id; END IF;

  -- Another hotel's demo at that time blocks it.
  IF EXISTS (
    SELECT 1 FROM public.tourism_demo_bookings
    WHERE agent_id = 'agent-2' AND slot_start = p_slot_start AND status = 'booked'
  ) THEN
    RAISE EXCEPTION 'Ese horario ya está reservado. Elija otro.' USING ERRCODE = '23P01';
  END IF;

  -- One active booking per hotel: the agent's new time replaces the previous one.
  UPDATE public.tourism_demo_bookings
  SET status = 'cancelled', updated_at = now()
  WHERE link_id = v_link.id AND status = 'booked';

  INSERT INTO public.tourism_demo_bookings
    (link_id, prospect_id, slot_start, slot_end, status, booked_by, agent_id, idempotency_key, guest_name, guest_note)
  VALUES
    (v_link.id, p_prospect_id, p_slot_start, p_slot_start + interval '5 minutes', 'booked', 'agent', 'agent-2',
     'staff:' || p_prospect_id::text || ':' || EXTRACT(EPOCH FROM p_slot_start)::bigint, '', '')
  -- The same time booked again after a cancellation brings that row back.
  ON CONFLICT (idempotency_key) DO UPDATE SET status = 'booked', updated_at = now()
  RETURNING id INTO v_booking_id;

  INSERT INTO public.tourism_milestones (prospect_id, milestone, channel, source, agent_id, due_at, slot_confirmed)
  VALUES (p_prospect_id, 'demo_agendada', '', 'manual', v_staff, p_slot_start, true)
  ON CONFLICT (prospect_id, milestone) DO UPDATE
    SET due_at = EXCLUDED.due_at, slot_confirmed = true;

  INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
  VALUES (v_staff, p_prospect_id, 'note',
    'Demo agendada para el '
    || to_char(p_slot_start AT TIME ZONE 'America/Costa_Rica', 'DD/MM HH12:MI AM') || ' (Costa Rica).');

  RETURN v_booking_id;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_tourism_demo_booking(p_token text, p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_link public.tourism_hotel_demo_links;
  v_slot timestamptz;
BEGIN
  IF p_token IS NULL OR p_token !~ '^(plw-)?[0-9a-f]{48}$' THEN
    RAISE EXCEPTION 'Solicitud no válida.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_link FROM public.tourism_hotel_demo_links
  WHERE token = ltrim(p_token, 'plw-') AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enlace no disponible.' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.tourism_demo_bookings
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_booking_id AND link_id = v_link.id AND status = 'booked'
  RETURNING slot_start INTO v_slot;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva no encontrada.' USING ERRCODE = 'P0002'; END IF;

  -- Alejandro must not keep a demo the hotel cancelled, and he sees why in the activity.
  DELETE FROM public.tourism_milestones
  WHERE prospect_id = v_link.prospect_id AND milestone = 'demo_agendada' AND due_at = v_slot;
  INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
  VALUES ('agent-2', v_link.prospect_id, 'note',
    'El hotel canceló desde su enlace la demo del '
    || to_char(v_slot AT TIME ZONE 'America/Costa_Rica', 'DD/MM HH12:MI AM') || ' (Costa Rica).');
END $$;

CREATE OR REPLACE FUNCTION public.set_payment_status(p_prospect_id uuid, p_payment_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner text;
  v_old text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF p_payment_status NOT IN ('not_recorded', 'pending', 'paid') THEN
    RAISE EXCEPTION 'Estado de pago no válido.';
  END IF;
  SELECT p.owner_id, p.payment_status INTO v_owner, v_old
  FROM public.prospects p WHERE p.id = p_prospect_id FOR UPDATE;
  UPDATE public.prospects
  SET payment_status = p_payment_status, updated_at = now()
  WHERE id = p_prospect_id;
  -- The recorded confirmation the weekly funnel counts; once per move to paid.
  IF p_payment_status = 'paid' AND v_old IS DISTINCT FROM 'paid' AND v_owner IS NOT NULL THEN
    INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
    VALUES (v_owner, p_prospect_id, 'note', 'Pago confirmado por administración.');
  END IF;
END;
$$;
