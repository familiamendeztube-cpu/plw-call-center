/*
# Fix advisory lock expression in book_tourism_demo_from_link

The previous version called an undefined helper on a record field inside the lock key.
The lock must be the same key used by the staff booking path: 'tourism-demo:agent-2:<slot>'.
Only the function body changes; no data, grants or policies change.
*/
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

  PERFORM pg_advisory_xact_lock(hashtext('tourism-demo:agent-2:' || p_slot_start::text));

  IF EXISTS (
    SELECT 1 FROM public.tourism_demo_bookings
    WHERE agent_id = 'agent-2' AND slot_start = p_slot_start AND status = 'booked'
  ) THEN
    RAISE EXCEPTION 'Ese horario acaba de ocuparse. Elija otro, por favor.' USING ERRCODE = '23P01';
  END IF;

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
    SELECT * INTO v_existing FROM public.tourism_demo_bookings WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('booking_id', v_existing.id, 'slot_start', v_existing.slot_start,
      'status', v_existing.status, 'duplicate', true);
  END IF;

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
REVOKE ALL ON FUNCTION public.book_tourism_demo_from_link(text, timestamptz, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_tourism_demo_from_link(text, timestamptz, text, text, text) TO anon, authenticated;
