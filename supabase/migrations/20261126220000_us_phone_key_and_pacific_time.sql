/*
# One phone number = one key: Costa Rica 8 digits, US 10

Owner 2026-11-26: the business is US now; Costa Rica only calls in. Four functions matched phone
numbers on their last 8 digits, which is right for Costa Rica but makes different US numbers the
same customer (305-555-1234 and 405-555-1234 share "55551234"), and could match a Costa Rica
caller to a US customer. They now use public.phone_key, the same rule as phoneKey in
src/features/telephony/models/call.ts:
- 506 + 8 digits or 8 digits -> the 8 digits (Costa Rica)
- 1 + 10 digits or 10 digits -> the 10 digits (US)
- anything else -> all its digits

Changed only in the matching lines and the "exactly 8 digits" checks (now "at least 8"), from
the live definitions of agent_create_prospect, record_ai_call, record_whatsapp_message and
start_whatsapp_customer.

Also: the US dialer's daily call cap resets at midnight Pacific (the app's clock), not Costa Rica.
*/

CREATE OR REPLACE FUNCTION public.phone_key(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN d ~ '^506[0-9]{8}$' THEN right(d, 8)
    WHEN d ~ '^1[0-9]{10}$' THEN right(d, 10)
    ELSE d
  END
  FROM (SELECT regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g') AS d) AS digits
$$;
REVOKE ALL ON FUNCTION public.phone_key(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.agent_create_prospect(p_business_name text, p_contact_name text, p_email text, p_phone text, p_business_category text, p_service_interest text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_me text := public.current_staff_id();
  v_name text := btrim(COALESCE(p_business_name, ''));
  v_phone text := btrim(COALESCE(p_phone, ''));
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_digits text := public.phone_key(p_phone);
  v_existing uuid;
  v_owner text;
  v_prospect uuid;
BEGIN
  IF v_me IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles s WHERE s.id = v_me AND s.role = 'agent'
  ) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'Escriba el nombre del negocio (hasta 160 caracteres).';
  END IF;
  IF v_phone = '' AND v_email = '' THEN
    RAISE EXCEPTION 'Agregue un teléfono o un correo.';
  END IF;
  IF v_phone <> '' AND (char_length(v_digits) < 8 OR char_length(v_phone) > 40) THEN
    RAISE EXCEPTION 'El teléfono debe tener al menos 8 dígitos.';
  END IF;
  IF v_email <> '' AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR char_length(v_email) > 254) THEN
    RAISE EXCEPTION 'El correo no es válido.';
  END IF;

  -- Two adds of one number or email at the same moment cannot create two customers.
  PERFORM pg_advisory_xact_lock(1113, hashtext(COALESCE(NULLIF(v_digits, ''), v_email)));

  -- Same phone_key match as start_whatsapp_customer; an own customer wins.
  SELECT p.id, p.owner_id INTO v_existing, v_owner
  FROM public.prospects p
  WHERE NOT p.is_test AND (
    (v_digits <> '' AND public.phone_key(p.phone) = v_digits)
    OR (v_email <> '' AND lower(p.email) = v_email)
  )
  ORDER BY (p.owner_id = v_me) DESC NULLS LAST, p.created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    IF v_owner = v_me THEN
      RETURN v_existing;
    END IF;
    RAISE EXCEPTION 'Ese teléfono o correo ya pertenece a otro cliente. Pídale al administrador que se lo asigne.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.prospects (
    business_name, contact_name, email, phone, business_category, service_interest,
    source, owner_id, stage, created_by
  ) VALUES (
    v_name,
    left(btrim(COALESCE(p_contact_name, '')), 120),
    v_email,
    v_phone,
    left(btrim(COALESCE(p_business_category, '')), 120),
    left(btrim(COALESCE(p_service_interest, '')), 160),
    'manual', v_me, 'new', v_me
  )
  RETURNING id INTO v_prospect;

  INSERT INTO public.conversations (prospect_id, subject, status)
  VALUES (v_prospect, v_name, 'waiting_customer');
  -- Assigned by the agent's own action, not by round-robin.
  INSERT INTO public.assignment_queue (prospect_id, status, assigned_at, assigned_to)
  VALUES (v_prospect, 'assigned', now(), v_me);
  INSERT INTO public.assignment_history (prospect_id, to_owner_id, mechanism, reason, actor_id)
  VALUES (v_prospect, v_me, 'manual', 'El agente agregó el cliente', v_me);
  INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
  VALUES (v_me, v_prospect, 'assignment', 'Agregó el cliente ' || v_name);

  RETURN v_prospect;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_ai_call(p_call jsonb, p_route boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conversation text := p_call->>'conversation_id';
  v_phone text := COALESCE(p_call->>'callback_phone', p_call->>'caller_phone');
  v_digits text := public.phone_key(v_phone);
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
    -- ponytail: phone_key scans prospects; index a normalized phone column if it grows.
    IF char_length(v_digits) >= 8 THEN
      SELECT p.id INTO v_prospect FROM public.prospects p
      WHERE NOT p.is_test AND public.phone_key(p.phone) = v_digits
        -- Same number, different name: another person on a shared phone, so a new customer.
        AND public.ai_same_person(p.contact_name, p_call->>'customer_name')
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
$function$;

CREATE OR REPLACE FUNCTION public.record_whatsapp_message(p_conversation_id integer, p_phone text, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_phone text := left(btrim(COALESCE(p_phone, '')), 40);
  v_name text := left(btrim(COALESCE(p_name, '')), 120);
  v_digits text := public.phone_key(p_phone);
  v_prospect uuid;
  v_matches integer := 0;
  v_newest uuid;
  v_named integer := 0;
  v_named_newest uuid;
  v_ambiguous boolean := false;
BEGIN
  -- Serializes deliveries for one chat, so its first two messages cannot create two customers.
  PERFORM pg_advisory_xact_lock(1111, p_conversation_id);
  SELECT c.prospect_id INTO v_prospect
  FROM public.whatsapp_chats c WHERE c.chatwoot_conversation_id = p_conversation_id;

  IF v_prospect IS NULL THEN
    -- The number decides the customer, not the name: replies go to that number, and a WhatsApp
    -- profile name is often a nickname or the shop's name.
    -- Same phone_key match as record_ai_call (Costa Rica 8 digits, US 10).
    IF char_length(v_digits) >= 8 THEN
      SELECT count(*),
             (array_agg(p.id ORDER BY p.created_at DESC))[1],
             count(*) FILTER (WHERE v_name <> '' AND p.contact_name <> ''
                                AND public.ai_same_person(p.contact_name, v_name)),
             (array_agg(p.id ORDER BY p.created_at DESC)
                FILTER (WHERE v_name <> '' AND p.contact_name <> ''
                          AND public.ai_same_person(p.contact_name, v_name)))[1]
      INTO v_matches, v_newest, v_named, v_named_newest
      FROM public.prospects p
      WHERE NOT p.is_test AND public.phone_key(p.phone) = v_digits;

      IF v_matches = 1 THEN
        v_prospect := v_newest;
      ELSIF v_matches > 1 AND v_named = 1 THEN
        v_prospect := v_named_newest;
      ELSIF v_matches > 1 THEN
        -- ponytail: moving a chat to another customer is SQL only; add an admin action if this comes up.
        v_prospect := v_newest;
        v_ambiguous := true;
      END IF;
    END IF;

    IF v_prospect IS NULL THEN
      v_prospect := public.intake_inquiry(
        left(COALESCE(NULLIF(v_name, ''), NULLIF(v_phone, ''), 'WhatsApp'), 160),
        v_name, '', v_phone, '', '', 'whatsapp', NULL, false,
        'chatwoot:' || p_conversation_id, NULL
      );
    END IF;
    INSERT INTO public.whatsapp_chats (chatwoot_conversation_id, prospect_id, ambiguous_match)
    VALUES (p_conversation_id, v_prospect, v_ambiguous);
  ELSE
    UPDATE public.whatsapp_chats SET unread = true, last_message_at = now()
    WHERE chatwoot_conversation_id = p_conversation_id;
  END IF;

  -- The unread mark the agent's customer list already shows.
  UPDATE public.conversations
  SET unread = true, last_message_at = now(), status = 'waiting_agent'
  WHERE prospect_id = v_prospect;

  RETURN v_prospect;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_whatsapp_customer(p_agent text, p_phone text, p_name text)
 RETURNS TABLE(customer uuid, conversation integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_phone text := left(btrim(COALESCE(p_phone, '')), 40);
  v_name text := left(btrim(COALESCE(p_name, '')), 120);
  v_digits text := public.phone_key(p_phone);
  v_prospect uuid;
  v_others integer;
BEGIN
  IF char_length(v_digits) < 8 OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles s WHERE s.id = p_agent AND s.role = 'agent' AND s.is_enabled
  ) THEN
    RAISE EXCEPTION 'Solicitud no válida.' USING ERRCODE = '22023';
  END IF;
  -- Two starts for one number at the same moment cannot create two customers.
  PERFORM pg_advisory_xact_lock(1112, hashtext(v_digits));

  -- Same phone_key match as record_whatsapp_message; the newest of the agent's own
  -- customers wins, without the duplicate warning, since the agent chose the number.
  SELECT (array_agg(p.id ORDER BY p.created_at DESC) FILTER (WHERE p.owner_id = p_agent))[1],
         count(*) FILTER (WHERE p.owner_id IS DISTINCT FROM p_agent)
  INTO v_prospect, v_others
  FROM public.prospects p
  WHERE NOT p.is_test AND public.phone_key(p.phone) = v_digits;

  IF v_prospect IS NULL AND v_others > 0 THEN
    RETURN; -- Someone else's customer: no row, and the function sends nothing.
  END IF;

  IF v_prospect IS NULL THEN
    INSERT INTO public.prospects (business_name, contact_name, phone, source, owner_id, stage, created_by)
    VALUES (COALESCE(NULLIF(v_name, ''), v_phone), v_name, v_phone, 'whatsapp', p_agent, 'contacted', p_agent)
    RETURNING id INTO v_prospect;
    INSERT INTO public.conversations (prospect_id, subject, status)
    VALUES (v_prospect, COALESCE(NULLIF(v_name, ''), v_phone), 'waiting_customer');
    -- Assigned by the agent's own action, not by round-robin.
    INSERT INTO public.assignment_queue (prospect_id, status, assigned_at, assigned_to)
    VALUES (v_prospect, 'assigned', now(), p_agent);
    INSERT INTO public.assignment_history (prospect_id, to_owner_id, mechanism, reason, actor_id)
    VALUES (v_prospect, p_agent, 'manual', 'Inició un chat de WhatsApp desde PLW', p_agent);
  END IF;

  RETURN QUERY
  SELECT v_prospect,
         (SELECT c.chatwoot_conversation_id FROM public.whatsapp_chats c
          WHERE c.prospect_id = v_prospect ORDER BY c.last_message_at DESC LIMIT 1);
END;
$function$;

-- The daily cap counts Pacific days, like the rest of the app.
CREATE OR REPLACE FUNCTION public.claim_us_call(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_runtime public.us_dialer_runtime%ROWTYPE;
  v_lead public.us_leads%ROWTYPE;
  v_lead_id uuid;
  v_callback uuid;
  v_call uuid;
  -- Configurar points the transfer at agent-2's phone, so Alejandro must be online (as tourism).
  v_staff text := 'agent-2';
BEGIN
  -- Same lock as claim_tourism_call and reserve_tourism_test: one claim at a time on the line.
  PERFORM pg_advisory_xact_lock(72104104);
  SELECT * INTO v_runtime FROM public.us_dialer_runtime WHERE id = 1 FOR UPDATE;
  IF v_runtime.paused OR NOT v_runtime.scheduler_ready OR v_runtime.provider_agent_id IS NULL
     OR v_runtime.caller_e164 IS NULL OR v_runtime.transfer_uri IS NULL
     OR v_runtime.config_verified_at IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.us_calls WHERE state IN ('reserved', 'started', 'uncertain'))
     OR EXISTS (SELECT 1 FROM public.tourism_calls WHERE state IN ('reserved', 'started', 'uncertain'))
     OR EXISTS (SELECT 1 FROM public.dental_calls WHERE state IN ('reserved', 'started', 'uncertain')) THEN
    RETURN NULL;
  END IF;
  IF v_runtime.checked_at IS DISTINCT FROM (p_now AT TIME ZONE 'America/Los_Angeles')::date THEN
    UPDATE public.us_dialer_runtime
    SET checked_at = (p_now AT TIME ZONE 'America/Los_Angeles')::date, dialed_today = 0
    WHERE id = 1;
    v_runtime.dialed_today := 0;
  END IF;
  IF v_runtime.dialed_today >= v_runtime.daily_cap THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles s
    JOIN public.staff_presence p ON p.staff_id = s.id
    WHERE s.id = v_staff AND s.is_enabled
      AND p.availability = 'active' AND p.operational IS NULL
      AND p.last_heartbeat_at BETWEEN p_now - interval '90 seconds' AND p_now + interval '5 seconds'
  ) THEN
    RETURN NULL;
  END IF;

  -- A number that opted out after the callback was agreed is never called back.
  UPDATE public.us_callbacks cb
  SET status = 'cancelled', fail_reason = 'Número en la lista de no llamar.'
  WHERE cb.status = 'pending'
    AND EXISTS (SELECT 1 FROM public.ai_outbound_do_not_call d WHERE d.phone = cb.phone);

  -- Due callbacks first, inside the lead's own calling hours.
  SELECT cb.id, cb.lead_id INTO v_callback, v_lead_id
  FROM public.us_callbacks cb
  JOIN public.us_leads l ON l.id = cb.lead_id
  WHERE cb.status = 'pending' AND cb.scheduled_for <= p_now AND l.dest = 'us'
    AND public.us_window_open(l.timezone, p_now, v_runtime.allowed_from, v_runtime.allowed_to)
  ORDER BY cb.scheduled_for
  LIMIT 1;
  IF FOUND THEN
    -- Closed as it is dialed: a pending callback in the past would be redialed every tick.
    UPDATE public.us_callbacks
    SET status = 'done', attempts = attempts + 1, claimed_at = p_now
    WHERE id = v_callback;
  ELSE
    SELECT l.id INTO v_lead_id
    FROM public.us_leads l
    JOIN public.us_campaigns c ON c.id = l.campaign_id
    WHERE c.name = 'EE. UU. · Negocios en español' AND l.dest = 'us'
      AND NOT EXISTS (SELECT 1 FROM public.us_calls x WHERE x.lead_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM public.us_callbacks cb WHERE cb.lead_id = l.id AND cb.status = 'pending')
      AND NOT EXISTS (SELECT 1 FROM public.ai_outbound_do_not_call d WHERE d.phone = l.phone_e164)
      AND public.us_window_open(l.timezone, p_now, v_runtime.allowed_from, v_runtime.allowed_to)
    ORDER BY l.created_at, l.id
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT * INTO v_lead FROM public.us_leads WHERE id = v_lead_id;
  INSERT INTO public.us_calls (lead_id, campaign_id, staff_id, phone, provider_agent_id, is_test)
  VALUES (v_lead.id, v_lead.campaign_id, v_staff, v_lead.phone_e164, v_runtime.provider_agent_id, false)
  RETURNING id INTO v_call;
  UPDATE public.us_leads SET last_call_at = p_now, updated_at = now() WHERE id = v_lead.id;
  UPDATE public.us_dialer_runtime SET dialed_today = dialed_today + 1 WHERE id = 1;
  RETURN jsonb_build_object(
    'call', jsonb_build_object('id', v_call, 'phone', v_lead.phone_e164,
                               'provider_agent_id', v_runtime.provider_agent_id,
                               'is_test', false, 'staff_id', v_staff, 'lead_id', v_lead.id),
    'lead', jsonb_build_object('id', v_lead.id, 'business_name', v_lead.business_name,
                               'contact_name', v_lead.contact_name, 'business_type', v_lead.business_type,
                               'timezone', v_lead.timezone)
  );
END $function$;
