/*
# Promised tourism callbacks go to Alejandro, not back to Anna

1. Plain-English
   - Anna tells hotels "Alejandro le llama mañana a las diez". Until now the dialer
     dialed that promise itself with Anna's cold-call opening. From now on the
     dialer never dials promises: each confirmed day+time becomes a "callback"
     follow-up for the assigned agent (Alejandro), due at the promised time.
   - The same hand-off records the "Devolución agendada" milestone. The runner used
     to look the customer up itself, but the service role cannot read prospects,
     so that milestone was silently never written.
   - A call with a confirmed promise becomes a customer even when its outcome code
     is not one of the "interested" ones (e.g. "the manager is out, call tomorrow"),
     so the follow-up always has a customer to hang on.
   - The pending Marina Pez Vela promise (24/11 10:00) is handed off right here.

2. Security
   - tourism_hand_promise_to_agent: SECURITY DEFINER, service_role only.
   - claim_tourism_call / tourism_call_to_customer keep their existing grants.
*/

CREATE OR REPLACE FUNCTION public.claim_tourism_call(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r tourism_dialer_runtime;
  l ai_outbound_leads;
  c tourism_calls;
  cb tourism_callbacks;
  v_local timestamp := p_now AT TIME ZONE 'America/Costa_Rica';
  v_staff_id text := 'agent-2';
BEGIN
  PERFORM pg_advisory_xact_lock(72104104);
  SELECT * INTO r FROM tourism_dialer_runtime WHERE id = 1 FOR UPDATE;
  IF r.paused OR r.config_verified_at IS NULL OR r.provider_agent_id IS NULL
     OR r.transfer_uri IS NULL THEN
    RETURN NULL;
  END IF;
  IF r.checked_at <> v_local::date THEN
    UPDATE tourism_dialer_runtime SET checked_at = v_local::date, dialed_today = 0 WHERE id = 1;
    r.dialed_today := 0;
  END IF;
  IF r.dialed_today >= r.daily_cap THEN RETURN NULL; END IF;
  IF extract(isodow FROM v_local) > 5
     OR v_local::time < r.allowed_from
     OR v_local::time >= r.allowed_to THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM staff_profiles s
    JOIN staff_presence p ON p.staff_id = s.id
    WHERE s.id = v_staff_id AND s.is_enabled AND s.role = 'agent'
      AND p.availability = 'active' AND p.operational IS NULL
      AND p.last_heartbeat_at BETWEEN p_now - interval '90 seconds' AND p_now + interval '5 seconds'
  ) THEN
    RETURN NULL;
  END IF;
  -- Shared line: one in-flight call anywhere (dental or tourism) blocks a new claim.
  IF EXISTS (SELECT 1 FROM dental_calls WHERE state IN ('reserved','started','uncertain'))
     OR EXISTS (SELECT 1 FROM tourism_calls WHERE state IN ('reserved','started','uncertain')) THEN
    RETURN NULL;
  END IF;

  -- A number that opted out since the callback was agreed is never called back.
  UPDATE tourism_callbacks t SET status = 'cancelled'
  WHERE t.status = 'pending'
    AND EXISTS (SELECT 1 FROM ai_outbound_do_not_call d WHERE d.phone = t.phone);

  -- Promised callbacks are no longer dialed here: Alejandro calls them himself from his
  -- follow-ups (tourism_hand_promise_to_agent).

  -- Fresh leads of the tourism campaign: never dialed, not blocked, no open callback.
  SELECT al.* INTO l
  FROM ai_outbound_leads al
  JOIN ai_outbound_campaigns ac ON ac.id = al.campaign_id
  WHERE ac.name = 'Turismo PLW'
    AND NOT EXISTS (SELECT 1 FROM ai_outbound_do_not_call d WHERE d.phone = al.phone)
    AND NOT EXISTS (SELECT 1 FROM tourism_calls t WHERE t.lead_id = al.id)
    AND NOT EXISTS (SELECT 1 FROM tourism_callbacks t WHERE t.lead_id = al.id AND t.status = 'pending')
  ORDER BY al.created_at, al.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO tourism_calls(lead_id, campaign_id, staff_id, phone, provider_agent_id)
  VALUES (l.id, l.campaign_id, v_staff_id, l.phone, r.provider_agent_id)
  RETURNING * INTO c;
  UPDATE tourism_dialer_runtime SET dialed_today = dialed_today + 1 WHERE id = 1;
  RETURN jsonb_build_object('call', to_jsonb(c), 'lead', to_jsonb(l));
END $function$;

CREATE OR REPLACE FUNCTION public.tourism_call_to_customer(p_call_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
c public.tourism_calls;
l public.ai_outbound_leads;
v_key text;
v_type text;
v_prospect uuid;
v_request uuid;
v_callback text;
BEGIN
SELECT * INTO c FROM public.tourism_calls WHERE id = p_call_id;
IF NOT FOUND OR c.is_test OR c.lead_id IS NULL OR c.conversation_id IS NULL
OR c.finished_at IS NULL
OR NOT (COALESCE(c.outcome IN (
'APPOINTMENT_CONFIRMED', 'INTERESTED_FOLLOW_UP', 'WHATSAPP_INFO_REQUESTED',
'EMAIL_INFO_REQUESTED', 'CALLBACK_REQUESTED', 'DEMO_SCHEDULED'
), false)
-- A confirmed day+time promise is a customer too: Alejandro must make that call.
OR (COALESCE(c.details->>'callback_date', '') <> '' AND COALESCE(c.details->>'callback_clock', '') <> '')) THEN
RETURN NULL;
END IF;

PERFORM pg_advisory_xact_lock(1110, hashtext(c.conversation_id));
SELECT r.id INTO v_request FROM public.ai_call_requests r WHERE r.conversation_id = c.conversation_id;
IF FOUND THEN
RETURN v_request;
END IF;

SELECT * INTO l FROM public.ai_outbound_leads WHERE id = c.lead_id;
v_key := 'tourism:' || l.id;
v_type := left(COALESCE(NULLIF(l.business_type, ''), 'Turismo'), 120);

SELECT p.id INTO v_prospect FROM public.prospects p
WHERE p.idempotency_key = v_key
OR (NOT p.is_test AND right(regexp_replace(p.phone, '\D', '', 'g'), 8) = l.phone)
ORDER BY p.idempotency_key IS NOT DISTINCT FROM v_key DESC, p.created_at DESC
LIMIT 1;

IF v_prospect IS NULL THEN
INSERT INTO public.prospects (
business_name, contact_name, phone, business_category, service_interest,
source, idempotency_key, owner_id
)
VALUES (
left(COALESCE(NULLIF(l.business_name, ''), 'Negocio de turismo'), 160),
left(COALESCE(NULLIF(c.details->>'contact_name', ''), l.contact_name), 120),
l.phone,
v_type,
left(COALESCE(c.details->>'interest', ''), 160),
'ai_call',
v_key,
c.staff_id
)
RETURNING id INTO v_prospect;

INSERT INTO public.conversations (prospect_id, subject)
VALUES (v_prospect, left(COALESCE(NULLIF(l.business_name, ''), 'Negocio de turismo'), 200));
INSERT INTO public.assignment_queue (prospect_id, status, assigned_at, assigned_to)
VALUES (v_prospect, 'assigned', now(), c.staff_id);
INSERT INTO public.assignment_history (prospect_id, from_owner_id, to_owner_id, mechanism, reason)
VALUES (v_prospect, NULL, c.staff_id, 'manual', 'Negocio de turismo que habló con Anna');
INSERT INTO public.notifications (staff_id, prospect_id, kind, body)
VALUES (c.staff_id, v_prospect, 'assignment',
left('Anna dejó un negocio de turismo para usted: ' || l.business_name, 300));
INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
VALUES (c.staff_id, v_prospect, 'assignment', left('Cliente de Anna (turismo): ' || l.business_name, 300));
END IF;

v_callback := regexp_replace(
COALESCE(NULLIF(c.details->>'callback_phone', ''), c.details->>'whatsapp_number', ''), '\D', '', 'g');

INSERT INTO public.ai_call_requests (
conversation_id, prospect_id, caller_phone, callback_phone, customer_name, business_name,
business_type, reason, preferred_contact, preferred_time, summary, call_started_at, status
)
VALUES (
c.conversation_id,
v_prospect,
l.phone,
CASE WHEN char_length(v_callback) BETWEEN 8 AND 15 THEN v_callback END,
left(c.details->>'contact_name', 120),
left(l.business_name, 160),
v_type,
left(NULLIF(concat_ws(' · ',
c.details->>'interest',
'Correo: ' || (c.details->>'contact_email'),
'WhatsApp: ' || (c.details->>'whatsapp_number'),
'Decide: ' || (c.details->>'decision_maker')
), ''), 500),
CASE c.outcome
WHEN 'WHATSAPP_INFO_REQUESTED' THEN 'whatsapp'
WHEN 'EMAIL_INFO_REQUESTED' THEN 'email'
ELSE 'phone'
END,
left(NULLIF(concat_ws(' ', c.details->>'callback_date', c.details->>'callback_clock'), ''), 200),
left(NULLIF(c.summary, ''), 4000),
c.created_at,
'pending'
)
RETURNING id INTO v_request;

RETURN v_request;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tourism_hand_promise_to_agent(p_call_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_call tourism_calls;
  v_cb tourism_callbacks;
  v_business text;
  v_prospect uuid;
  v_agent text;
  v_when text;
  v_title text;
BEGIN
  SELECT * INTO v_call FROM tourism_calls WHERE id = p_call_id;
  IF NOT FOUND OR v_call.is_test THEN RETURN; END IF;
  SELECT p.id INTO v_prospect FROM prospects p
  WHERE p.idempotency_key = 'tourism:' || v_call.lead_id::text;
  -- No customer yet: the promise stays pending and visible on the admin card.
  IF v_prospect IS NULL THEN RETURN; END IF;
  SELECT business_name INTO v_business FROM ai_outbound_leads WHERE id = v_call.lead_id;
  v_agent := COALESCE(v_call.staff_id, 'agent-2');
  FOR v_cb IN
    SELECT * FROM tourism_callbacks WHERE call_id = p_call_id AND status = 'pending' FOR UPDATE
  LOOP
    v_when := to_char(v_cb.scheduled_for AT TIME ZONE 'America/Costa_Rica', 'DD/MM "a las" HH12:MI AM');
    v_title := left('Llamar a ' || COALESCE(NULLIF(v_business, ''), v_cb.phone) || ' (' || v_cb.phone ||
      '): Anna prometió que Alejandro llama el ' || v_when, 200);
    -- Exactly once per promise: deterministic title, checked before insert.
    IF NOT EXISTS (SELECT 1 FROM followups f WHERE f.prospect_id = v_prospect AND f.title = v_title) THEN
      INSERT INTO followups (prospect_id, agent_id, kind, title, due_at)
      VALUES (v_prospect, v_agent, 'callback', v_title, v_cb.scheduled_for);
      INSERT INTO activity_events (agent_id, prospect_id, kind, summary)
      VALUES (v_agent, v_prospect, 'note',
        left('Anna acordó por teléfono que Alejandro llama el ' || v_when || '.', 300));
    END IF;
    INSERT INTO tourism_milestones (prospect_id, milestone, channel, source, agent_id, due_at, slot_confirmed)
    VALUES (v_prospect, 'devolucion_agendada', 'phone', 'auto', v_agent, v_cb.scheduled_for, true)
    ON CONFLICT (prospect_id, milestone) DO NOTHING;
    UPDATE tourism_callbacks SET status = 'done', claimed_at = now() WHERE id = v_cb.id;
  END LOOP;
END $function$;

REVOKE ALL ON FUNCTION public.tourism_hand_promise_to_agent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tourism_hand_promise_to_agent(uuid) TO service_role;

-- Promises already waiting (Marina Pez Vela, 24/11 10:00) go to Alejandro now.
SELECT public.tourism_hand_promise_to_agent(t.call_id)
FROM (SELECT DISTINCT call_id FROM public.tourism_callbacks WHERE status = 'pending' AND call_id IS NOT NULL) t;
