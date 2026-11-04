/*
# Round-robin ignores presence; AI calls fill the customer record

1. Plain-English summary
- Before: an inquiry went only to an agent who was online and set to Activo. With nobody online it waited in the queue, unassigned, until someone signed in.
- Now: every enabled agent takes turns in order, whether Activo, in Pausa or signed out. An inquiry waits only when every agent is at their workload limit.
- AI calls now also save the business type the caller gave (new ElevenLabs field business_type).
- The customer record gets the caller's name, business type and reason from the call, but only where those fields are still empty. Nothing already on the record is overwritten.
- Existing AI customers are filled the same way, and inquiries already waiting are assigned now.

2. Changed objects
- pick_round_robin_agent: presence (Activo, Pausa, heartbeat) no longer counts.
- ai_call_requests: new column business_type.
- record_ai_call: stores business_type and fills empty customer fields.

3. Security
- No grants change. Both functions stay server-only.
*/

CREATE OR REPLACE FUNCTION public.pick_round_robin_agent()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_last text;
  v_agent text;
  v_default_limit integer := public.setting_int('default_max_active_prospects', 10);
BEGIN
  SELECT c.last_staff_id INTO v_last FROM public.assignment_cursor c WHERE c.id = 1 FOR UPDATE;

  -- Owner's rule (2026-11-04): turns go round every enabled agent, online or not.
  SELECT s.id INTO v_agent
  FROM public.staff_profiles s
  WHERE s.role = 'agent'
    AND s.is_enabled
    AND s.auth_user_id IS NOT NULL
    AND (
      SELECT count(*)
      FROM public.prospects pr
      WHERE pr.owner_id = s.id AND pr.stage NOT IN ('won', 'lost')
    ) < COALESCE(s.max_active_prospects, v_default_limit)
  ORDER BY (s.id > COALESCE(v_last, '')) DESC, s.id ASC
  LIMIT 1;

  IF v_agent IS NOT NULL THEN
    UPDATE public.assignment_cursor SET last_staff_id = v_agent WHERE id = 1;
  END IF;

  RETURN v_agent;
END;
$$;

ALTER TABLE public.ai_call_requests
  ADD COLUMN IF NOT EXISTS business_type text CHECK (char_length(business_type) <= 120);

CREATE OR REPLACE FUNCTION public.record_ai_call(p_call jsonb, p_route boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conversation text := p_call->>'conversation_id';
  v_phone text := COALESCE(p_call->>'callback_phone', p_call->>'caller_phone');
  v_digits text := right(regexp_replace(COALESCE(v_phone, ''), '\D', '', 'g'), 8);
  v_id uuid;
  v_prospect uuid;
BEGIN
  -- Serializes concurrent deliveries of the same call; the second one returns the first row.
  PERFORM pg_advisory_xact_lock(1110, hashtext(v_conversation));
  SELECT r.id INTO v_id FROM public.ai_call_requests r WHERE r.conversation_id = v_conversation;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  IF p_route THEN
    -- ponytail: last-8-digit match assumes Costa Rica numbers and scans prospects; index a normalized phone column if it grows.
    IF char_length(v_digits) = 8 THEN
      SELECT p.id INTO v_prospect FROM public.prospects p
      WHERE NOT p.is_test AND right(regexp_replace(p.phone, '\D', '', 'g'), 8) = v_digits
      ORDER BY p.created_at DESC
      LIMIT 1;
    END IF;
    IF v_prospect IS NULL THEN
      v_prospect := public.intake_inquiry(
        left(COALESCE(p_call->>'business_name', p_call->>'customer_name', v_phone, 'Llamada IA'), 160),
        COALESCE(p_call->>'customer_name', ''),
        '',
        COALESCE(v_phone, ''),
        '',
        '',
        'ai_call',
        NULL,
        false,
        'elevenlabs:' || v_conversation,
        NULL
      );
    END IF;

    -- New and returning callers alike: fill only what is still empty.
    UPDATE public.prospects p
    SET contact_name = COALESCE(NULLIF(p.contact_name, ''), p_call->>'customer_name', ''),
        business_category = COALESCE(NULLIF(p.business_category, ''), p_call->>'business_type', ''),
        service_interest = COALESCE(NULLIF(p.service_interest, ''), left(p_call->>'reason', 160), ''),
        updated_at = now()
    WHERE p.id = v_prospect;
  END IF;

  INSERT INTO public.ai_call_requests (
    conversation_id, prospect_id, caller_phone, callback_phone, customer_name, business_name,
    business_type, reason, preferred_contact, preferred_time, consent, summary, call_started_at,
    call_duration_seconds, status
  )
  VALUES (
    v_conversation, v_prospect, p_call->>'caller_phone', p_call->>'callback_phone',
    p_call->>'customer_name', p_call->>'business_name', p_call->>'business_type', p_call->>'reason',
    p_call->>'preferred_contact', p_call->>'preferred_time', (p_call->>'consent')::boolean,
    p_call->>'summary', (p_call->>'call_started_at')::timestamptz,
    (p_call->>'call_duration_seconds')::integer,
    CASE WHEN p_route THEN 'pending' ELSE 'canceled' END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_ai_call(jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_call(jsonb, boolean) TO service_role;

-- Calls saved before this change: same fill-only-empty rule, from each customer's latest call.
UPDATE public.prospects p
SET contact_name = COALESCE(NULLIF(p.contact_name, ''), r.customer_name, ''),
    service_interest = COALESCE(NULLIF(p.service_interest, ''), left(r.reason, 160), ''),
    updated_at = now()
FROM (
  SELECT DISTINCT ON (prospect_id) prospect_id, customer_name, reason
  FROM public.ai_call_requests
  WHERE prospect_id IS NOT NULL
  ORDER BY prospect_id, call_started_at DESC
) r
WHERE p.id = r.prospect_id AND (p.contact_name = '' OR p.service_interest = '');

-- Inquiries that were waiting for someone to come online get an owner now.
SELECT public.process_waiting_queue();
