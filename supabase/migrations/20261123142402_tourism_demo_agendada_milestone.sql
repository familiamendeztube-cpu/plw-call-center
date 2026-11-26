/*
# Add the "Demo agendada" milestone between Devolución agendada and Demo realizada

1. Plain-English
   - A new tourism funnel stage: a demo (the personalized English-after-hours
     walkthrough) that was explicitly AGREED with a confirmed Costa Rica date
     and time. It sits between "Devolución agendada" (callback booked) and
     "Demo realizada" (demo actually completed).
   - A demo agreement is only recorded from a real conversation outcome where
     the person confirmed BOTH a date and a time, or by an authorized manual
     entry by the assigned agent or an admin. A mere callback agreement, an
     email/WhatsApp request or an unconfirmed offer never creates the row.
   - Re-running with the same agreement (replayed events) is a no-op; changing
     the agreed time updates the slot on the same row instead of duplicating.
   - The demo itself is never auto-completed: "Demo realizada" stays manual.

2. Modified tables
   - `tourism_milestones`: the milestone CHECK now allows 'demo_agendada';
     new columns `due_at timestamptz` (agreed CR date/time as UTC) and
     `slot_confirmed boolean` (true when both date and time were confirmed).
     Existing rows are untouched (slot_confirmed NULL for them, backfilled to
     true for the auto devolucion rows where the slot was always confirmed).

3. Modified functions
   - `public.add_tourism_milestone(uuid, text, text, timestamptz)`: accepts the
     new milestone and an optional agreed slot. For 'demo_agendada' the slot is
     required and the row is upserted so a later authorized entry changes the
     agreed time on the same row (audit via activity_events).

4. New function
   - `public.record_tourism_demo_agreement(uuid, text, timestamptz)`: called by
     the dialer runner (service role) when a real outcome captured a confirmed
     demo day+time. Idempotent per call: replays of the same conversation
     update the slot in place; no duplicate rows or duplicate activity events.

5. Security
   - Unchanged RLS: milestones stay readable by staff, writable only through
     the SECURITY DEFINER functions. EXECUTE on the new function is granted to
     service_role only; add_tourism_milestone keeps its authenticated grant.
*/
ALTER TABLE public.tourism_milestones
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS slot_confirmed boolean;

UPDATE public.tourism_milestones
SET slot_confirmed = true
WHERE milestone = 'devolucion_agendada' AND slot_confirmed IS NULL;

ALTER TABLE public.tourism_milestones DROP CONSTRAINT IF EXISTS tourism_milestones_milestone_check;
ALTER TABLE public.tourism_milestones
  ADD CONSTRAINT tourism_milestones_milestone_check
  CHECK (milestone IN ('material_entregado','devolucion_agendada','demo_agendada','demo_realizada'));

CREATE OR REPLACE FUNCTION public.add_tourism_milestone(
  p_prospect_id uuid, p_milestone text, p_channel text DEFAULT '', p_due_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_owner text;
  v_id uuid;
BEGIN
  IF p_milestone NOT IN ('material_entregado','devolucion_agendada','demo_agendada','demo_realizada') THEN
    RAISE EXCEPTION 'Hito no válido.';
  END IF;
  IF COALESCE(p_channel, '') NOT IN ('', 'email', 'whatsapp', 'phone') THEN
    RAISE EXCEPTION 'Canal no válido.';
  END IF;
  IF p_milestone = 'demo_agendada' AND p_due_at IS NULL THEN
    RAISE EXCEPTION 'La demo agendada necesita fecha y hora confirmadas.';
  END IF;
  SELECT owner_id INTO v_owner FROM public.prospects WHERE id = p_prospect_id;
  IF v_owner IS NULL OR NOT (v_owner = public.current_staff_id() OR public.is_admin()) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.tourism_milestones (prospect_id, milestone, channel, source, agent_id, due_at, slot_confirmed)
  VALUES (p_prospect_id, p_milestone, COALESCE(p_channel, ''), 'manual', public.current_staff_id(), p_due_at,
          CASE WHEN p_milestone = 'demo_agendada' THEN true END)
  ON CONFLICT (prospect_id, milestone) DO UPDATE
    SET due_at = EXCLUDED.due_at,
        agent_id = EXCLUDED.agent_id,
        channel = EXCLUDED.channel,
        slot_confirmed = true
  RETURNING id INTO v_id;
  INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
  VALUES (public.current_staff_id(), p_prospect_id, 'note',
    CASE
      WHEN p_milestone = 'demo_agendada' THEN
        'Demo agendada para el ' || to_char(p_due_at AT TIME ZONE 'America/Costa_Rica', 'DD/MM HH12:MI AM')
      ELSE 'Hito registrado: ' || p_milestone
    END);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.record_tourism_demo_agreement(
  p_call_id uuid, p_due_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_call public.tourism_calls;
  v_prospect uuid;
  v_existing uuid;
  v_new_slot boolean;
BEGIN
  IF p_due_at IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_call FROM public.tourism_calls WHERE id = p_call_id;
  IF NOT FOUND OR v_call.is_test OR v_call.lead_id IS NULL THEN RETURN NULL; END IF;
  SELECT p.id INTO v_prospect FROM public.prospects p
  WHERE p.idempotency_key = 'tourism:' || v_call.lead_id::text;
  IF v_prospect IS NULL THEN RETURN NULL; END IF;
  -- The demo never completes automatically, and a completed demo stays closed.
  IF EXISTS (
    SELECT 1 FROM public.tourism_milestones
    WHERE prospect_id = v_prospect AND milestone = 'demo_realizada'
  ) THEN
    RETURN NULL;
  END IF;
  SELECT id, (due_at IS DISTINCT FROM p_due_at) INTO v_existing, v_new_slot
  FROM public.tourism_milestones
  WHERE prospect_id = v_prospect AND milestone = 'demo_agendada';
  IF v_existing IS NOT NULL AND NOT v_new_slot THEN
    RETURN v_existing; -- replayed event with the same slot: no-op, no duplicate activity
  END IF;
  INSERT INTO public.tourism_milestones
    (prospect_id, milestone, channel, source, agent_id, due_at, slot_confirmed)
  VALUES
    (v_prospect, 'demo_agendada', 'phone', 'auto', COALESCE(v_call.staff_id, 'agent-2'), p_due_at, true)
  ON CONFLICT (prospect_id, milestone) DO UPDATE
    SET due_at = EXCLUDED.due_at, agent_id = EXCLUDED.agent_id, slot_confirmed = true
  RETURNING id INTO v_existing;
  INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
  VALUES (COALESCE(v_call.staff_id, 'agent-2'), v_prospect, 'note',
    'Demo agendada por Anna para el ' ||
    to_char(p_due_at AT TIME ZONE 'America/Costa_Rica', 'DD/MM HH12:MI AM'));
  RETURN v_existing;
END $$;

REVOKE EXECUTE ON FUNCTION public.add_tourism_milestone(uuid, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_tourism_milestone(uuid, text, text, timestamptz) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.record_tourism_demo_agreement(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_tourism_demo_agreement(uuid, timestamptz) TO service_role;
