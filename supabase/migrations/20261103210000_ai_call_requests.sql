/*
# Calls handled by the ElevenLabs AI receptionist

1. Plain-English summary
- Each finished AI call is saved once, keyed by its ElevenLabs conversation ID, with what the customer said: name, business, reason, contact method, callback time and consent. Anything the customer did not say stays empty.
- A call that should reach an agent becomes a customer through the same intake as email inquiries, so it joins the waiting queue and the round-robin rotation. Only signed-in agents set to Activo receive it; otherwise it waits.
- A caller whose number already belongs to a customer is attached to that customer and their current agent instead of creating a duplicate.
- The assigned agent or an administrator moves the request through pending, in progress, completed or canceled. The last change records who and when.

2. New tables
- ai_call_requests: one row per AI conversation. prospect_id is empty when the call was not sent to an agent.
- ai_webhook_failures: signed webhook deliveries that could not be processed. Holds a reason code and the conversation ID only, never customer details.

3. Functions
- record_ai_call (server only): idempotent save of one call; repeated deliveries return the original row.
- set_ai_call_status (assigned agent or administrator).

4. Security
- RLS on both tables. Agents read only requests of customers they own; administrators read all, including calls not sent to an agent. Failures are administrator-only.
- No browser role can write either table. This project does not grant table access automatically, so every grant is explicit.
*/

CREATE TABLE IF NOT EXISTS public.ai_call_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id text NOT NULL UNIQUE CHECK (conversation_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  caller_phone text CHECK (caller_phone ~ '^\+?[0-9]{3,20}$'),
  callback_phone text CHECK (callback_phone ~ '^\+?[0-9]{3,20}$'),
  customer_name text CHECK (char_length(customer_name) <= 120),
  business_name text CHECK (char_length(business_name) <= 160),
  reason text CHECK (char_length(reason) <= 500),
  preferred_contact text CHECK (preferred_contact IN ('phone', 'whatsapp')),
  preferred_time text CHECK (char_length(preferred_time) <= 200),
  consent boolean,
  summary text CHECK (char_length(summary) <= 4000),
  call_started_at timestamptz NOT NULL,
  call_duration_seconds integer CHECK (call_duration_seconds >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'canceled')),
  status_by text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  status_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_call_requests_status_idx ON public.ai_call_requests (status, created_at);
CREATE INDEX IF NOT EXISTS ai_call_requests_prospect_idx ON public.ai_call_requests (prospect_id);

CREATE TABLE IF NOT EXISTS public.ai_webhook_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reason text NOT NULL CHECK (reason ~ '^[a-z_]{1,40}$'),
  conversation_id text CHECK (conversation_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_call_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_webhook_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_call_requests, public.ai_webhook_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_call_requests, public.ai_webhook_failures TO authenticated;
GRANT INSERT ON public.ai_webhook_failures TO service_role;

DROP POLICY IF EXISTS "ai_call_requests_select_owner_or_admin" ON public.ai_call_requests;
CREATE POLICY "ai_call_requests_select_owner_or_admin" ON public.ai_call_requests
  FOR SELECT TO authenticated
  USING (public.can_access_prospect(prospect_id));

DROP POLICY IF EXISTS "ai_webhook_failures_select_admin" ON public.ai_webhook_failures;
CREATE POLICY "ai_webhook_failures_select_admin" ON public.ai_webhook_failures
  FOR SELECT TO authenticated
  USING (public.is_admin());

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
  END IF;

  INSERT INTO public.ai_call_requests (
    conversation_id, prospect_id, caller_phone, callback_phone, customer_name, business_name,
    reason, preferred_contact, preferred_time, consent, summary, call_started_at,
    call_duration_seconds, status
  )
  VALUES (
    v_conversation, v_prospect, p_call->>'caller_phone', p_call->>'callback_phone',
    p_call->>'customer_name', p_call->>'business_name', p_call->>'reason',
    p_call->>'preferred_contact', p_call->>'preferred_time', (p_call->>'consent')::boolean,
    p_call->>'summary', (p_call->>'call_started_at')::timestamptz,
    (p_call->>'call_duration_seconds')::integer,
    CASE WHEN p_route THEN 'pending' ELSE 'canceled' END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_ai_call_status(p_request_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me text := public.current_staff_id();
  v_prospect uuid;
BEGIN
  SELECT r.prospect_id INTO v_prospect FROM public.ai_call_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_me IS NULL OR v_prospect IS NULL OR NOT public.can_access_prospect(v_prospect) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'in_progress', 'completed', 'canceled') THEN
    RAISE EXCEPTION 'Estado no válido.';
  END IF;

  UPDATE public.ai_call_requests
  SET status = p_status, status_by = v_me, status_at = now()
  WHERE id = p_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_ai_call(jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_ai_call_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_ai_call(jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_ai_call_status(uuid, text) TO authenticated;
