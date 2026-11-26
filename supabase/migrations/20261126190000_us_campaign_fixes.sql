/*
# US campaign: fixes after reviewing the Bolt batch of 2026-11-26

Builds on 20261126163006_us_campaign_espanol, 20261126163339_us_campaign_alerts_and_tz and
20261126163432_us_classify_search_path (already live). The dialer stays paused: nothing here
places a call.

1. US opt-outs. `ai_outbound_do_not_call` only accepted 8-digit Costa Rica numbers, so every US
   "do not call" (call analysis and the admin button) failed to save. It now also takes +1 E.164.
2. Calling hours. Leads defaulted to New York, so a California business was called at 5:00.
   Unknown zone ('') now means the safe window: open in both New York and Los Angeles. 808/907
   get Hawaii/Alaska. An unknown IANA name is excluded at classification (it stopped every claim).
3. Classification. Costa Rica numbers are 'cr' (they came out 'invalid'); Bermuda and 900/976
   premium are 'other'; N11 area codes are invalid; numbers on the do-not-call list are 'dnc'.
4. claim_us_call. Same advisory lock as tourism; Alejandro (agent-2) like tourism, since
   `us_campaign_agents` was never filled and nothing could be claimed; do-not-call excluded; a
   dialed callback is closed (it stayed pending and was redialed on every tick).
5. reserve_us_test returns `claimed` like tourism (the test call was reserved but never dialed),
   needs the US number, refuses blocked numbers, and is idempotent per request.
6. enable_us_scheduler. The cron the US dialer needs; Configurar calls it. `scheduler_ready` was
   never set, so Iniciar always failed.
7. us_call_to_customer stores the callback phone as E.164 (the AI gives bare digits).
8. us_prepare_sample picks the business's own template (restaurant, clinic...), not tourism.
9. us_sms_send returns `to_e164`; the function needs it to send.
10. us_mark_dnc. The admin "No llamar" button in one call (browsers cannot update us_leads).
11. Callbacks: resolve/reschedule are admin-only; reschedule takes the business's local time.
12. US leads and callbacks are readable by admins only, like US calls.
*/

-- 1. ---------------------------------------------------------------------------------------
ALTER TABLE public.ai_outbound_do_not_call DROP CONSTRAINT IF EXISTS ai_outbound_do_not_call_phone_check;
ALTER TABLE public.ai_outbound_do_not_call ADD CONSTRAINT ai_outbound_do_not_call_phone_check
  CHECK (phone ~ '^[2-8][0-9]{7}$' OR phone ~ '^\+1[2-9][0-9]{9}$');

-- 2. ---------------------------------------------------------------------------------------
ALTER TABLE public.us_leads ALTER COLUMN timezone SET DEFAULT '';
ALTER TABLE public.us_leads DROP CONSTRAINT IF EXISTS us_leads_timezone_check;
ALTER TABLE public.us_leads ADD CONSTRAINT us_leads_timezone_check
  CHECK (timezone = '' OR timezone ~ '^[A-Za-z_]+/[A-Za-z_+-]{1,40}$');

-- Weekday and inside [from, to) in the lead's zone; unknown zone must be open on both coasts.
-- ponytail: unknown zone = 11:00-16:00 New York only; add an area-code -> zone table if too narrow.
CREATE OR REPLACE FUNCTION public.us_window_open(p_tz text, p_now timestamptz, p_from time, p_to time)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT bool_and(
    extract(isodow FROM p_now AT TIME ZONE z) <= 5
    AND (p_now AT TIME ZONE z)::time >= p_from
    AND (p_now AT TIME ZONE z)::time < p_to
  )
  FROM unnest(CASE WHEN p_tz = '' THEN ARRAY['America/New_York', 'America/Los_Angeles']
                   ELSE ARRAY[p_tz] END) AS z
$$;

-- 3. ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.us_normalize_phone(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_raw, ''), '\D', '', 'g');
  v_national text;
BEGIN
  IF char_length(v_digits) = 11 AND left(v_digits, 1) = '1' THEN
    v_national := right(v_digits, 10);
  ELSIF char_length(v_digits) = 10 THEN
    v_national := v_digits;
  ELSE
    RETURN NULL;
  END IF;
  IF left(v_national, 1) IN ('0', '1') THEN RETURN NULL; END IF;
  IF substring(v_national, 2, 2) = '11' THEN RETURN NULL; END IF; -- N11 is never an area code
  IF substring(v_national, 4, 1) IN ('0', '1') THEN RETURN NULL; END IF;
  RETURN '+1' || v_national;
END $$;

CREATE OR REPLACE FUNCTION public.classify_us_phone(p_e164 text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $$
DECLARE
  v_area int;
BEGIN
  IF p_e164 IS NULL THEN RETURN 'invalid'; END IF;
  IF left(p_e164, 4) = '+506' THEN RETURN 'cr'; END IF;
  IF left(p_e164, 2) <> '+1' OR char_length(p_e164) <> 12 THEN RETURN 'other'; END IF;
  v_area := substring(p_e164, 3, 3)::int;
  -- +1 outside the US market: Puerto Rico, Dominican Republic, Caribbean, Bermuda, Pacific
  -- territories, and premium-rate 900/976.
  IF v_area IN (787, 939, 809, 829, 849, 242, 246, 264, 268, 284, 340, 345, 441, 473, 649, 664,
                670, 671, 684, 721, 758, 767, 784, 868, 869, 876, 658, 900, 976) THEN
    RETURN 'other';
  END IF;
  IF v_area IN (204, 226, 236, 249, 250, 263, 289, 306, 343, 354, 365, 367, 368, 403, 416,
                418, 428, 431, 437, 438, 450, 468, 474, 506, 514, 519, 548, 579, 581, 584,
                587, 604, 613, 639, 647, 683, 705, 709, 742, 753, 778, 780, 782, 807, 819,
                825, 867, 873, 879, 902, 905) THEN
    RETURN 'ca';
  END IF;
  RETURN 'us';
END $$;

CREATE OR REPLACE FUNCTION public.us_classify_lead_rows(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row record;
  v_digits text;
  v_norm text;
  v_dest text;
  v_tz text;
  v_reason text;
  v_marked int := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  FOR v_row IN
    SELECT id, raw_phone, timezone FROM public.us_leads
    WHERE campaign_id = p_campaign_id AND dest = 'invalid' AND raw_phone <> ''
    ORDER BY created_at, id
  LOOP
    v_digits := regexp_replace(v_row.raw_phone, '\D', '', 'g');
    v_tz := v_row.timezone;
    v_reason := NULL;
    IF v_digits ~ '^(506)?[2-8][0-9]{7}$' THEN
      v_norm := '+506' || right(v_digits, 8);
      v_dest := 'cr';
    ELSE
      v_norm := public.us_normalize_phone(v_row.raw_phone);
      v_dest := public.classify_us_phone(v_norm);
    END IF;
    IF v_dest = 'us' THEN
      IF v_tz = '' THEN
        v_tz := CASE substring(v_norm, 3, 3)
          WHEN '808' THEN 'Pacific/Honolulu' WHEN '907' THEN 'America/Anchorage' ELSE '' END;
      END IF;
      IF EXISTS (SELECT 1 FROM public.ai_outbound_do_not_call d WHERE d.phone = v_norm) THEN
        v_dest := 'dnc';
      ELSIF EXISTS (
        SELECT 1 FROM public.us_leads x
        WHERE x.campaign_id = p_campaign_id AND x.id <> v_row.id
          AND x.phone_e164 = v_norm AND x.dest IN ('us', 'dnc')
      ) THEN
        v_dest := 'dup';
      ELSIF v_tz <> '' AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_tz) THEN
        v_dest := 'invalid';
        v_reason := 'Zona horaria desconocida.';
      END IF;
    END IF;
    UPDATE public.us_leads
    SET phone_e164 = v_norm,
        dest = v_dest,
        timezone = v_tz,
        excluded_reason = COALESCE(v_reason, CASE v_dest
          WHEN 'us' THEN ''
          WHEN 'dup' THEN 'Duplicado por número completo.'
          WHEN 'dnc' THEN 'En la lista de no llamar.'
          WHEN 'cr' THEN 'Número de Costa Rica: pertenece a las campañas CR, no aquí.'
          WHEN 'ca' THEN 'Número de Canadá: fuera del mercado de esta campaña.'
          WHEN 'other' THEN 'Número +1 fuera de EE. UU. continental o de tarifa especial.'
          ELSE 'Teléfono ilegible.'
        END),
        updated_at = now()
    WHERE id = v_row.id;
    v_marked := v_marked + 1;
  END LOOP;
  RETURN jsonb_build_object('classified', v_marked);
END $$;

-- 4. ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_us_call(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
  IF v_runtime.checked_at IS DISTINCT FROM (p_now AT TIME ZONE 'America/Costa_Rica')::date THEN
    UPDATE public.us_dialer_runtime
    SET checked_at = (p_now AT TIME ZONE 'America/Costa_Rica')::date, dialed_today = 0
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
END $$;

-- 5. ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_us_test(p_id uuid, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_phone text := public.us_normalize_phone(p_phone);
  r public.us_dialer_runtime%ROWTYPE;
  c public.us_calls%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo administración.';
  END IF;
  IF v_phone IS NULL OR public.classify_us_phone(v_phone) <> 'us' THEN
    RAISE EXCEPTION 'La llamada de prueba necesita un número de EE. UU. válido.';
  END IF;
  PERFORM pg_advisory_xact_lock(72104104);
  SELECT * INTO c FROM public.us_calls WHERE id = p_id;
  IF FOUND THEN
    IF c.phone <> v_phone OR NOT c.is_test THEN
      RAISE EXCEPTION 'Solicitud ya utilizada.';
    END IF;
    RETURN jsonb_build_object('claimed', false, 'call', to_jsonb(c));
  END IF;
  SELECT * INTO r FROM public.us_dialer_runtime WHERE id = 1 FOR UPDATE;
  IF r.config_verified_at IS NULL OR r.provider_agent_id IS NULL OR r.transfer_uri IS NULL THEN
    RAISE EXCEPTION 'Configure la voz primero.';
  END IF;
  -- The US number stands for "the US route exists": without it a +1 call has no trunk.
  IF r.caller_e164 IS NULL THEN
    RAISE EXCEPTION 'Falta el número de EE. UU.: escríbalo y presione Configurar.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_outbound_do_not_call WHERE phone = v_phone) THEN
    RAISE EXCEPTION 'Número bloqueado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.us_calls WHERE phone = v_phone AND state IN ('reserved', 'started', 'uncertain')) THEN
    RAISE EXCEPTION 'Hay llamadas pendientes de finalizar.';
  END IF;
  INSERT INTO public.us_calls (id, is_test, staff_id, phone, provider_agent_id)
  VALUES (p_id, true, public.current_staff_id(), v_phone, r.provider_agent_id)
  RETURNING * INTO c;
  RETURN jsonb_build_object('claimed', true, 'call', to_jsonb(c));
END $$;

-- 6. ---------------------------------------------------------------------------------------
-- Every 30 s (tourism ticks every 10 s): one call at a time, and half the function invocations.
CREATE OR REPLACE FUNCTION public.enable_us_scheduler()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'plw_dental_runner_key') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'plw_dental_runner_key', 'Dialer dispatcher authentication');
  END IF;
  PERFORM cron.schedule('plw-us-dialer', '30 seconds', $job$
SELECT net.http_post(
url := 'https://meagbbmittuhdgwnhvxa.supabase.co/functions/v1/us-dialer',
headers := jsonb_build_object('Content-Type', 'application/json', 'X-PLW-Runner',
(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'plw_dental_runner_key')),
body := '{"action":"tick"}'::jsonb,
timeout_milliseconds := 60000
)
$job$);
  UPDATE public.us_dialer_runtime SET scheduler_ready = true WHERE id = 1;
END $$;

-- 7. ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.us_call_to_customer(p_call_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  c public.us_calls%ROWTYPE;
  l public.us_leads%ROWTYPE;
  v_key text;
  v_type text;
  v_prospect uuid;
  v_request uuid;
BEGIN
  SELECT * INTO c FROM public.us_calls WHERE id = p_call_id;
  IF NOT FOUND OR c.is_test OR c.lead_id IS NULL OR c.conversation_id IS NULL
     OR c.finished_at IS NULL OR c.ended_reason IS DISTINCT FROM 'human'
     OR NOT COALESCE(c.outcome IN (
       'APPOINTMENT_CONFIRMED', 'INTERESTED_FOLLOW_UP', 'EMAIL_INFO_REQUESTED',
       'CALLBACK_REQUESTED', 'DEMO_SCHEDULED'
     ), false) THEN
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
END $$;

-- 8. ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.us_prepare_sample(p_prospect_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
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
                      'CALLBACK_REQUESTED', 'DEMO_SCHEDULED')
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
END $$;

-- 9. ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.us_sms_send(
  p_lead_id uuid,
  p_idempotency_key text,
  p_body text,
  p_web_url text,
  p_secretary_url text,
  p_sender_id text,
  p_service_sid text,
  p_call_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_lead public.us_leads%ROWTYPE;
  v_existing record;
  v_status text;
  v_to text;
  v_id uuid;
BEGIN
  SELECT * INTO v_lead FROM public.us_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead no encontrado.';
  END IF;
  SELECT id, status, to_e164 INTO v_existing FROM public.us_sms_messages
  WHERE lead_id = p_lead_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_existing.id, 'status', v_existing.status,
                              'to_e164', v_existing.to_e164, 'reused', true);
  END IF;
  v_to := CASE WHEN v_lead.sms_mobile ~ '^\+1[2-9][0-9]{9}$' THEN v_lead.sms_mobile ELSE v_lead.phone_e164 END;
  IF v_to IS NULL OR v_to !~ '^\+1[2-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'El contacto no tiene un móvil de EE. UU.';
  END IF;
  v_status := CASE WHEN v_lead.sms_consent AND v_lead.sms_mobile <> '' THEN 'queued' ELSE 'suppressed' END;
  INSERT INTO public.us_sms_messages (
    lead_id, call_id, to_e164, body, web_url, secretary_url, sender_id,
    messaging_service_sid, status, idempotency_key
  ) VALUES (
    p_lead_id, p_call_id, v_to,
    left(p_body, 800), left(p_web_url, 300), left(p_secretary_url, 300),
    left(p_sender_id, 20), left(p_service_sid, 40), v_status, left(p_idempotency_key, 120)
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'status', v_status, 'to_e164', v_to, 'reused', false);
END $$;

-- 10. --------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.us_mark_dnc(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_phone text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  SELECT phone_e164 INTO v_phone FROM public.us_leads WHERE id = p_lead_id;
  IF v_phone IS NULL OR v_phone !~ '^\+1[2-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'El contacto no tiene un número de EE. UU.';
  END IF;
  INSERT INTO public.ai_outbound_do_not_call (phone, reason)
  VALUES (v_phone, 'Excluido de la campaña de EE. UU.')
  ON CONFLICT (phone) DO NOTHING;
  UPDATE public.us_leads
  SET dest = 'dnc', excluded_reason = 'Marcado como no llamar.', updated_at = now()
  WHERE id = p_lead_id;
  UPDATE public.us_callbacks
  SET status = 'cancelled', fail_reason = 'Número en la lista de no llamar.'
  WHERE phone = v_phone AND status = 'pending';
END $$;

-- 11. --------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_us_callback(p_callback_id uuid, p_status text, p_reason text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  IF p_status NOT IN ('done', 'cancelled', 'failed', 'resolved') THEN
    RAISE EXCEPTION 'Estado no válido.';
  END IF;
  UPDATE public.us_callbacks
  SET status = p_status, fail_reason = left(COALESCE(p_reason, ''), 240),
      resolved_at = now(), resolved_by = public.current_staff_id()
  WHERE id = p_callback_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolución no encontrada o ya resuelta.';
  END IF;
END $$;

-- The browser sends the wall clock the admin typed ("2026-12-01T10:30"); it is the business's
-- local time, the same zone the card shows the callback in.
DROP FUNCTION IF EXISTS public.reschedule_us_callback(uuid, timestamptz);
CREATE OR REPLACE FUNCTION public.reschedule_us_callback(p_callback_id uuid, p_local text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_local timestamp;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  BEGIN
    v_local := p_local::timestamp;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Fecha u hora no válida.';
  END;
  UPDATE public.us_callbacks
  SET scheduled_for = v_local AT TIME ZONE timezone, status = 'pending'
  WHERE id = p_callback_id AND status IN ('pending', 'failed');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolución no encontrada.';
  END IF;
END $$;

-- 12. --------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff read US leads" ON public.us_leads;
DROP POLICY IF EXISTS "Admin read US leads" ON public.us_leads;
CREATE POLICY "Admin read US leads" ON public.us_leads
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Staff read US callbacks" ON public.us_callbacks;
DROP POLICY IF EXISTS "Admin read US callbacks" ON public.us_callbacks;
CREATE POLICY "Admin read US callbacks" ON public.us_callbacks
  FOR SELECT TO authenticated USING (public.is_admin());

-- Grants ------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.us_window_open(text, timestamptz, time, time) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enable_us_scheduler() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enable_us_scheduler() TO service_role;
REVOKE ALL ON FUNCTION public.us_mark_dnc(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.us_mark_dnc(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.reschedule_us_callback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_us_callback(uuid, text) TO authenticated;
