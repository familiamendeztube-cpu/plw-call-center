/*
# US callback follow-up: explicit agreement, future slot within 24 hours, no duplicates

1. Plain-English explanation
   Anna books Alejandro's follow-up only when the business explicitly agreed on a day and
   time. The live SQL already required `callback_confirmed = 'true'` (explicit agreement),
   a valid date and clock, the lead's own time zone, and created the follow-up once per
   conversation (idempotent on `ai_call_requests.conversation_id`). Two corrections here:
   (a) the agreed slot must be in the FUTURE and no later than 24 hours after the call
   ended — anything else is dropped, never booked; (b) the outcome list no longer includes
   `TRANSFERRED_TO_SPECIALIST`, since the US agent has no transfer tool since 2026-11-27.

2. Functions replaced (CREATE OR REPLACE, same signature — nothing dropped)
   - `us_call_to_customer(p_call_id uuid)`:
     - Keeps: ended-with-a-human gate (`ended_reason = 'human'`), test-call exclusion,
       idempotency (one conversation per call; advisory lock keyed by conversation),
       full-E.164 prospect matching, customer/conversation/assignment/notification inserts
       with the claim's staff id as owner, single follow-up insert, and the
       `ai_call_requests` upsert.
     - Adds: the confirmed slot must satisfy `v_due > c.finished_at` and
       `v_due <= c.finished_at + interval '24 hours'` (computed in the business's own time
       zone, DST-safe via `AT TIME ZONE`). Otherwise no follow-up is created.

3. Security
   - Stays SECURITY DEFINER with `SET search_path TO 'public', 'extensions', 'pg_temp'`.
   - No privilege changes; grants untouched.

4. Notes
   - Additive and re-runnable (CREATE OR REPLACE, same signature).
   - No data read or written beyond what the function already does when invoked by the
     runner; nothing here changes campaign state, pause, numbers or history.
*/

CREATE OR REPLACE FUNCTION public.us_call_to_customer(p_call_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  c public.us_calls%ROWTYPE;
  l public.us_leads%ROWTYPE;
  v_key text;
  v_type text;
  v_prospect uuid;
  v_request uuid;
  v_tz text;
  v_due timestamptz;
BEGIN
  SELECT * INTO c FROM public.us_calls WHERE id = p_call_id;
  IF NOT FOUND OR c.is_test OR c.lead_id IS NULL OR c.conversation_id IS NULL
     OR c.finished_at IS NULL OR c.ended_reason IS DISTINCT FROM 'human'
     OR NOT (COALESCE(c.outcome IN (
       'APPOINTMENT_CONFIRMED', 'INTERESTED_FOLLOW_UP', 'EMAIL_INFO_REQUESTED',
       'CALLBACK_REQUESTED', 'DEMO_SCHEDULED'
     ), false) OR COALESCE(c.details->>'callback_confirmed', '') = 'true') THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(1110, hashtext(c.conversation_id));
  SELECT r.id INTO v_request FROM public.ai_call_requests r WHERE r.conversation_id = c.conversation_id;
  IF FOUND THEN
    RETURN v_request;
  END IF;

  SELECT * INTO l FROM public.us_leads WHERE id = c.lead_id;
  v_key := 'us:' || l.id::text;
  v_type := left(COALESCE(NULLIF(l.business_type, ''), 'Negocio EE. UU.'), 120);

  -- Matched on the full number, never on the last 8 digits.
  SELECT p.id INTO v_prospect FROM public.prospects p
  WHERE p.idempotency_key = v_key OR (NOT p.is_test AND p.phone = l.phone_e164)
  ORDER BY p.idempotency_key IS NOT DISTINCT FROM v_key DESC, p.created_at DESC
  LIMIT 1;

  IF v_prospect IS NULL THEN
    INSERT INTO public.prospects (
      business_name, contact_name, phone, business_category, service_interest,
      source, idempotency_key, owner_id
    )
    VALUES (
      left(COALESCE(NULLIF(l.business_name, ''), 'Negocio de EE. UU.'), 160),
      left(COALESCE(NULLIF(c.details->>'contact_name', ''), l.contact_name), 120),
      l.phone_e164,
      v_type,
      left(COALESCE(c.details->>'interest', ''), 160),
      'ai_call_us',
      v_key,
      c.staff_id
    )
    RETURNING id INTO v_prospect;

    INSERT INTO public.conversations (prospect_id, subject)
    VALUES (v_prospect, left(COALESCE(NULLIF(l.business_name, ''), 'Negocio de EE. UU.'), 200));
    INSERT INTO public.assignment_queue (prospect_id, status, assigned_at, assigned_to)
    VALUES (v_prospect, 'assigned', now(), c.staff_id);
    INSERT INTO public.assignment_history (prospect_id, from_owner_id, to_owner_id, mechanism, reason)
    VALUES (v_prospect, NULL, c.staff_id, 'manual', 'Negocio de EE. UU. que habló con Anna');
    INSERT INTO public.notifications (staff_id, prospect_id, kind, body)
    VALUES (c.staff_id, v_prospect, 'assignment',
            left('Anna dejó un negocio de EE. UU. para usted: ' || l.business_name, 300));
    INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
    VALUES (c.staff_id, v_prospect, 'assignment', left('Cliente de Anna (EE. UU.): ' || l.business_name, 300));
  END IF;

  -- A day and time the business confirmed with Anna becomes Alejandro's follow-up, due at that
  -- moment in the business's own time zone (Pacific when unknown). Once per conversation.
  -- Owner rule (2026-11-27): explicit agreement (callback_confirmed), the slot must be in the
  -- future and no later than 24 hours after the call ended; anything else is never booked.
  IF COALESCE(c.details->>'callback_confirmed', '') = 'true'
     AND COALESCE(c.details->>'callback_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     AND COALESCE(c.details->>'callback_clock', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    v_tz := COALESCE(NULLIF(l.timezone, ''), 'America/Los_Angeles');
    v_due := ((c.details->>'callback_date') || ' ' || (c.details->>'callback_clock'))::timestamp AT TIME ZONE v_tz;
    IF v_due > c.finished_at AND v_due <= c.finished_at + interval '24 hours' THEN
      INSERT INTO public.followups (prospect_id, agent_id, kind, title, due_at)
      VALUES (v_prospect, c.staff_id, 'callback',
              left('Llamar (agendado por Anna): ' || COALESCE(NULLIF(l.business_name, ''), 'Negocio de EE. UU.')
                   || ' · ' || (c.details->>'callback_clock') || ' hora local (' || v_tz || ')', 200),
              v_due);
    END IF;
  END IF;

  INSERT INTO public.ai_call_requests (
    conversation_id, prospect_id, caller_phone, callback_phone, customer_name, business_name,
    business_type, reason, preferred_contact, preferred_time, summary, call_started_at, status
  )
  VALUES (
    c.conversation_id, v_prospect, l.phone_e164,
    public.us_normalize_phone(c.details->>'callback_phone'),
    left(c.details->>'contact_name', 120), left(l.business_name, 160), v_type,
    left(NULLIF(concat_ws(' · ',
      c.details->>'interest', c.details->>'objections', c.summary), ''), 300),
    'phone', left(COALESCE(c.details->>'callback_date', ''), 40),
    left(c.summary, 600), c.created_at, 'pending'
  )
  ON CONFLICT (conversation_id) DO UPDATE SET summary = EXCLUDED.summary
  RETURNING id INTO v_request;
  RETURN v_request;
END $function$;