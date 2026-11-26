/*
# Anna EE. UU.: 5 lines, transfers to the team line, callbacks for Alejandro

Owner decision 2026-11-26: Anna calls on 5 lines and every interested call ends with an offer to
talk to Alejandro now (transfer) or at an agreed time (callback). Built from the live
definitions; only the marked parts change.

1. us_dialer_runtime.max_lines (1-10), set to 5. claim_us_call allows that many US calls at once
   instead of one call across every dialer (the Costa Rica dialers are stopped).
2. claim_us_call no longer redials agreed callbacks: Alejandro makes them.
3. us_call_to_customer: a confirmed callback day and time becomes a follow-up for Alejandro at
   that moment in the business's time zone, and a call transferred to Alejandro
   (TRANSFERRED_TO_SPECIALIST) or with a confirmed callback becomes his customer.
4. us_prepare_sample accepts transferred calls too.
5. transfer_uri now holds the team line (+1 754-799-1065), which rings Alejandro and then
   PLW USA — Recepción; Configurar writes it.
*/

ALTER TABLE public.us_dialer_runtime
  ADD COLUMN IF NOT EXISTS max_lines integer NOT NULL DEFAULT 1 CHECK (max_lines BETWEEN 1 AND 10);
UPDATE public.us_dialer_runtime SET max_lines = 5, updated_at = now() WHERE id = 1;

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
  -- Up to max_lines US calls at once. The Costa Rica dialers are stopped (outbound is US-only).
  IF (SELECT count(*) FROM public.us_calls WHERE state IN ('reserved', 'started', 'uncertain'))
     >= v_runtime.max_lines THEN
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

  -- Fresh leads only, inside each business's calling hours. An agreed callback is Alejandro's
  -- (a follow-up on his Hoy list, made by us_call_to_customer); Anna never redials it.
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
       'CALLBACK_REQUESTED', 'DEMO_SCHEDULED', 'TRANSFERRED_TO_SPECIALIST'
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
  IF COALESCE(c.details->>'callback_confirmed', '') = 'true'
     AND COALESCE(c.details->>'callback_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     AND COALESCE(c.details->>'callback_clock', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    v_tz := COALESCE(NULLIF(l.timezone, ''), 'America/Los_Angeles');
    v_due := ((c.details->>'callback_date') || ' ' || (c.details->>'callback_clock'))::timestamp AT TIME ZONE v_tz;
    INSERT INTO public.followups (prospect_id, agent_id, kind, title, due_at)
    VALUES (v_prospect, c.staff_id, 'callback',
            left('Llamar (agendado por Anna): ' || COALESCE(NULLIF(l.business_name, ''), 'Negocio de EE. UU.')
                 || ' · ' || (c.details->>'callback_clock') || ' hora local (' || v_tz || ')', 200),
            v_due);
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

CREATE OR REPLACE FUNCTION public.us_prepare_sample(p_prospect_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_staff text := public.current_staff_id();
  v_type text;
  v_text text;
  v_category text;
  v_slug text;
  v_draft uuid;
  v_token text;
  v_existing record;
BEGIN
  IF v_staff IS NULL OR NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  SELECT l.business_type INTO v_type
  FROM public.us_calls c
  JOIN public.us_leads l ON l.id = c.lead_id
  JOIN public.prospects p ON p.idempotency_key = 'us:' || l.id::text
  WHERE p.id = p_prospect_id AND c.is_test = false
    AND c.ended_reason = 'human' AND c.finished_at IS NOT NULL
    AND c.outcome IN ('APPOINTMENT_CONFIRMED', 'INTERESTED_FOLLOW_UP',
                      'CALLBACK_REQUESTED', 'DEMO_SCHEDULED', 'TRANSFERRED_TO_SPECIALIST')
  ORDER BY c.finished_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La muestra se prepara solo cuando una llamada humana confirmó interés.';
  END IF;

  SELECT id, preview_token INTO v_existing FROM public.prospect_site_drafts
  WHERE prospect_id = p_prospect_id;
  IF FOUND THEN
    RETURN jsonb_build_object('draft_id', v_existing.id, 'preview_token', v_existing.preview_token, 'reused', true);
  END IF;

  -- Same guesses as guessSiteCategory (siteDraft.ts) plus the English words US lists use.
  v_text := translate(lower(COALESCE(v_type, '')), 'áéíóúüñ', 'aeiouun');
  v_category := CASE
    WHEN v_text ~ '(hosped|hotel|motel|cabin|alojam|hostal|lodge)' THEN 'lodging'
    WHEN v_text ~ '(tour|turis|viaje|travel)' THEN 'tours'
    WHEN v_text ~ '(restaur|soda|cafe|pizz|comida|marisc|taquer|food|bakery|panader)' THEN 'restaurant'
    WHEN v_text ~ '(clinic|dental|dentist|odonto|medic|consultorio|veterin|salud|health|doctor)' THEN 'clinic'
    WHEN v_text ~ '(gimnas|gym|fitness|crossfit)' THEN 'gym'
    WHEN v_text ~ '(inmobil|bienes raices|real estate|realt|propiedad)' THEN 'real_estate'
    WHEN v_text ~ '(taller|mecanic|mechanic|automotr|\mautos?\M|\mcarros?\M|\mcars?\M|vehicul|concesionari|dealer)' THEN 'auto'
    ELSE 'shop'
  END;
  v_slug := CASE v_category
    WHEN 'tours' THEN 'plw-tourism-tours'
    WHEN 'lodging' THEN 'plw-tourism-stays'
    WHEN 'real_estate' THEN 'plw-real-estate'
    ELSE 'plw-' || v_category
  END;

  INSERT INTO public.prospect_site_drafts (
    prospect_id, site_slug, business_name, locale, category, booking_phone,
    preview_token, created_by
  )
  SELECT p_prospect_id, v_slug, left(p.business_name, 120), 'es-US', v_category,
         p.phone, encode(extensions.gen_random_bytes(24), 'hex'), v_staff
  FROM public.prospects p WHERE p.id = p_prospect_id
  RETURNING id, preview_token INTO v_draft, v_token;

  RETURN jsonb_build_object('draft_id', v_draft, 'preview_token', v_token, 'reused', false);
END $function$;
