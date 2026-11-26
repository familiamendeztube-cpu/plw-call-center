/*
# Staff bookings always occupy Alejandro's calendar

1. Why
   `book_tourism_demo_as_staff` stored the booking staff member in `agent_id`, but the
   collision check and the unique index key on ('agent-2', slot) — Alejandro is the one
   giving the demo. An admin-side booking and a hotel-side booking could therefore take
   the same slot, and the second demo_agendada milestone update would be silently dropped.

2. Changes
   - `book_tourism_demo_as_staff(uuid, timestamptz)`: the booking row is now always
     written with agent_id='agent-2' (whose calendar it blocks), while the milestone
     keeps the recording staff member. Nothing else changes: same slot validation,
     same advisory lock, same idempotency key shape.

3. Security
   - Same grants: EXECUTE to authenticated only.
*/
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
  SELECT l.id, l.prospect_id, p_slot_start, p_slot_start + interval '5 minutes', 'booked', 'agent', 'agent-2',
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
    SELECT l.id, l.prospect_id, p_slot_start, p_slot_start + interval '5 minutes', 'booked', 'agent', 'agent-2',
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
