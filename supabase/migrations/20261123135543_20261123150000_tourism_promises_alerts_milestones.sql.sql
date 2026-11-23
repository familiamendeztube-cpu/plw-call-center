/*
# Tourism promised callbacks, 403 auto-pause alerts, and agent milestones

1. Summary
   Three linked production features for the PLW tourism campaign, all scoped to
   it (the dental dialer is untouched):

   A. Protect promised callbacks. When Anna's call confirms a day+time, the
      promise keeps its original agreement time and its assignment (the agent
      on the call — Alejandro). A failed automatic attempt marks the promise
      "failed" with the actual failure reason instead of silently "done", and
      the failed promise rises to the TOP of the assigned agent's follow-up
      queue as an actionable item with business, promised time and reason.
      The agent resolves or reschedules it through an authorized, idempotent,
      audited action; a rescheduled promise re-enters the automatic dialer.
   B. Two consecutive SIP 403s pause the campaign automatically before the
      next automatic dispatch, with a persistent, visible admin alert holding
      the evidence. The counter resets on any intervening non-403 result,
      guards races and replayed events, and only an explicit authorized
      restart clears the alert (it never dials).
   C. Agent-facing milestones after "mándeme información": Material entregado,
      Devolución agendada, Demo realizada. Stored with business, channel,
      timestamp, source and agent; real events create them automatically
      (material only on proven delivery or explicit manual confirmation,
      callbacks on actual confirmed agreement, demo on actual completion);
      manual actions are authorized and idempotent; nothing historical is
      invented. Admin sees counts by stage with a drilldown.

2. New tables
   - `tourism_dialer_alerts`: pause alerts with evidence; readable by signed-in
     staff; inserted by the service-role dialer; cleared only by the admin
     restart RPC.
   - `tourism_milestones`: one row per prospect+milestone (unique); readable by
     signed-in staff; inserted via the authorized RPC or the service role.

3. Modified tables
   - `tourism_callbacks`: + promised_at, fail_reason, resolved_at, resolved_by,
     attempts. Backfill marks the verified Villa del Sueño row (confirmed
     2:00pm promise; failed SIP 403 attempt at exactly the promised time)
     failed with its real reason.
   - `tourism_dialer_runtime`: + consecutive_403 counter.
   - Follow-up rows for failed promises reuse the existing `followups` table,
     so they surface in the current queue with no new plumbing; the existing
     followups RLS (agent sees own, admin sees all) applies unchanged.

4. Security
   - RLS enabled on both new tables with explicit policies.
   - New RPCs: resolve_tourism_callback, reschedule_tourism_callback (assigned
     agent from the originating call or admin; idempotent, audited),
     add_tourism_milestone (assigned agent or admin, idempotent),
     restart_tourism_after_alert (admin only).
*/

ALTER TABLE public.tourism_callbacks
  ADD COLUMN IF NOT EXISTS promised_at timestamptz,
  ADD COLUMN IF NOT EXISTS fail_reason text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by text,
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;

ALTER TABLE public.tourism_dialer_runtime
  ADD COLUMN IF NOT EXISTS consecutive_403 int NOT NULL DEFAULT 0;

UPDATE public.tourism_callbacks cb
SET promised_at = c.created_at
FROM public.tourism_calls c
WHERE cb.call_id = c.id AND cb.promised_at IS NULL;

UPDATE public.tourism_callbacks cb
SET status = 'failed', fail_reason = c.error
FROM public.tourism_calls c
WHERE cb.call_id = c.id
  AND cb.status = 'done'
  AND c.state = 'failed'
  AND c.error LIKE '%SIP 403%'
  AND c.finished_at >= cb.scheduled_for
  AND c.finished_at < cb.scheduled_for + interval '15 minutes';

ALTER TABLE public.tourism_callbacks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "callback history readable by staff" ON public.tourism_callbacks;
CREATE POLICY "callback history readable by staff"
ON public.tourism_callbacks FOR SELECT
TO authenticated
USING (true);

GRANT SELECT ON public.tourism_callbacks TO authenticated;
GRANT SELECT ON public.tourism_dialer_runtime TO authenticated;

CREATE TABLE IF NOT EXISTS public.tourism_dialer_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  cleared_by text
);
ALTER TABLE public.tourism_dialer_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dialer alerts readable by staff" ON public.tourism_dialer_alerts;
CREATE POLICY "dialer alerts readable by staff"
ON public.tourism_dialer_alerts FOR SELECT
TO authenticated
USING (true);
GRANT SELECT ON public.tourism_dialer_alerts TO authenticated;
GRANT INSERT ON public.tourism_dialer_alerts TO service_role;
GRANT UPDATE (cleared_at, cleared_by) ON public.tourism_dialer_alerts TO authenticated;

CREATE TABLE IF NOT EXISTS public.tourism_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  milestone text NOT NULL CHECK (milestone IN ('material_entregado','devolucion_agendada','demo_realizada')),
  channel text NOT NULL DEFAULT '' CHECK (channel IN ('', 'email', 'whatsapp', 'phone')),
  source text NOT NULL CHECK (source IN ('auto','manual')),
  agent_id text NOT NULL DEFAULT 'agent-2',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tourism_milestones_prospect_milestone
ON public.tourism_milestones (prospect_id, milestone);
ALTER TABLE public.tourism_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "milestones readable by staff" ON public.tourism_milestones;
CREATE POLICY "milestones readable by staff"
ON public.tourism_milestones FOR SELECT
TO authenticated
USING (true);
GRANT SELECT ON public.tourism_milestones TO authenticated;

-- --- Failed-promise resolution (assigned agent or admin; idempotent) -------------

CREATE OR REPLACE FUNCTION public.resolve_tourism_callback(p_callback_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_agent text;
BEGIN
  SELECT c.staff_id INTO v_agent
  FROM public.tourism_callbacks cb
  JOIN public.tourism_calls c ON c.id = cb.call_id
  WHERE cb.id = p_callback_id;
  IF v_agent IS NULL OR NOT (v_agent = public.current_staff_id() OR public.is_admin()) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  -- Idempotent: the first resolution wins; a note appends once.
  UPDATE public.tourism_callbacks
  SET status = CASE WHEN status = 'failed' THEN 'resolved' ELSE status END,
      resolved_at = COALESCE(resolved_at, now()),
      resolved_by = COALESCE(resolved_by, public.current_staff_id()),
      fail_reason = CASE
        WHEN COALESCE(btrim(COALESCE(p_note, '')), '') = '' THEN fail_reason
        WHEN fail_reason LIKE '%| Resuelto: ' || btrim(p_note) || '%' THEN fail_reason
        ELSE left(COALESCE(fail_reason, '') || ' | Resuelto: ' || btrim(p_note), 500)
      END
  WHERE id = p_callback_id;
END $$;

CREATE OR REPLACE FUNCTION public.reschedule_tourism_callback(p_callback_id uuid, p_new_slot timestamptz, p_note text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_agent text;
  v_lead uuid;
  v_phone text;
  v_call uuid;
  v_new_id uuid;
BEGIN
  SELECT c.staff_id, cb.lead_id, cb.phone, cb.call_id
  INTO v_agent, v_lead, v_phone, v_call
  FROM public.tourism_callbacks cb
  JOIN public.tourism_calls c ON c.id = cb.call_id
  WHERE cb.id = p_callback_id;
  IF v_agent IS NULL OR NOT (v_agent = public.current_staff_id() OR public.is_admin()) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  -- Re-running the same reschedule is a no-op.
  IF EXISTS (
    SELECT 1 FROM public.tourism_callbacks again
    WHERE again.lead_id = v_lead AND again.phone = v_phone
      AND again.status = 'pending' AND again.scheduled_for = p_new_slot
  ) THEN
    RETURN NULL;
  END IF;
  UPDATE public.tourism_callbacks
  SET status = CASE WHEN status = 'failed' THEN 'resolved' ELSE status END,
      resolved_at = COALESCE(resolved_at, now()),
      resolved_by = COALESCE(resolved_by, public.current_staff_id()),
      fail_reason = CASE
        WHEN COALESCE(btrim(COALESCE(p_note, '')), '') = '' THEN fail_reason
        WHEN fail_reason LIKE '%| Reagendado: ' || btrim(p_note) || '%' THEN fail_reason
        ELSE left(COALESCE(fail_reason, '') || ' | Reagendado: ' || btrim(p_note), 500)
      END
  WHERE id = p_callback_id;
  INSERT INTO public.tourism_callbacks (call_id, lead_id, phone, scheduled_for, promised_at)
  VALUES (v_call, v_lead, v_phone, p_new_slot, now())
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.resolve_tourism_callback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_tourism_callback(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reschedule_tourism_callback(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_tourism_callback(uuid, timestamptz, text) TO authenticated;

-- --- Authorized restart after a 403 auto-pause (admin only; never dials) ---------

CREATE OR REPLACE FUNCTION public.restart_tourism_after_alert()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Solo administración.' USING ERRCODE = '42501'; END IF;
  UPDATE public.tourism_dialer_runtime SET consecutive_403 = 0 WHERE id = 1;
  UPDATE public.tourism_dialer_alerts
  SET cleared_at = now(), cleared_by = public.current_staff_id()
  WHERE cleared_at IS NULL;
  -- Deliberately does not touch `paused`: only Iniciar starts dialing.
END $$;
REVOKE EXECUTE ON FUNCTION public.restart_tourism_after_alert() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restart_tourism_after_alert() TO authenticated;

-- --- Milestones (assigned agent or admin; idempotent per prospect+milestone) ------

CREATE OR REPLACE FUNCTION public.add_tourism_milestone(
  p_prospect_id uuid, p_milestone text, p_channel text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_owner text;
  v_id uuid;
BEGIN
  IF p_milestone NOT IN ('material_entregado','devolucion_agendada','demo_realizada') THEN
    RAISE EXCEPTION 'Hito no válido.';
  END IF;
  IF COALESCE(p_channel, '') NOT IN ('', 'email', 'whatsapp', 'phone') THEN
    RAISE EXCEPTION 'Canal no válido.';
  END IF;
  SELECT owner_id INTO v_owner FROM public.prospects WHERE id = p_prospect_id;
  IF v_owner IS NULL OR NOT (v_owner = public.current_staff_id() OR public.is_admin()) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.tourism_milestones (prospect_id, milestone, channel, source, agent_id)
  VALUES (p_prospect_id, p_milestone, COALESCE(p_channel, ''), 'manual', public.current_staff_id())
  ON CONFLICT (prospect_id, milestone) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
    VALUES (public.current_staff_id(), p_prospect_id, 'note', 'Hito registrado: ' || p_milestone);
  END IF;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.add_tourism_milestone(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_tourism_milestone(uuid, text, text) TO authenticated;

-- --- Failed promises rise to the actionable follow-up queue ----------------------
-- Service-role only: called from the runner's sync path exactly once per failed
-- attempt, so the duplicate guard relies on the deterministic title.

CREATE OR REPLACE FUNCTION public.tourism_raise_failed_promise(p_callback_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cb public.tourism_callbacks;
  v_lead public.ai_outbound_leads;
  v_prospect uuid;
  v_agent text;
  v_title text;
BEGIN
  SELECT * INTO v_cb FROM public.tourism_callbacks WHERE id = p_callback_id;
  IF v_cb.status <> 'failed' OR v_cb.resolved_at IS NOT NULL THEN RETURN; END IF;
  SELECT * INTO v_lead FROM public.ai_outbound_leads WHERE id = v_cb.lead_id;
  SELECT p.id INTO v_prospect FROM public.prospects p
  WHERE p.idempotency_key = 'tourism:' || v_cb.lead_id::text;
  SELECT c.staff_id INTO v_agent FROM public.tourism_calls c WHERE c.id = v_cb.call_id;
  IF v_prospect IS NULL THEN RETURN; END IF;
  v_title := left('Promesa incumplida: ' || COALESCE(v_lead.business_name, v_cb.phone) || ' — prometido ' ||
    to_char(v_cb.scheduled_for AT TIME ZONE 'America/Costa_Rica', 'DD/MM HH12:MI AM'), 200);
  -- Exactly once per failed promise: deterministic title, checked before insert.
  IF EXISTS (SELECT 1 FROM public.followups f WHERE f.prospect_id = v_prospect AND f.title = v_title) THEN
    RETURN;
  END IF;
  INSERT INTO public.followups (prospect_id, agent_id, kind, title, due_at)
  VALUES (v_prospect, COALESCE(v_agent, 'agent-2'), 'callback', v_title, now());
  INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
  VALUES (COALESCE(v_agent, 'agent-2'), v_prospect, 'note',
    'La llamada prometida no pudo realizarse: ' || left(COALESCE(p_reason, 'sin señal del proveedor'), 300));
END $$;
REVOKE EXECUTE ON FUNCTION public.tourism_raise_failed_promise(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tourism_raise_failed_promise(uuid, text) TO service_role;
