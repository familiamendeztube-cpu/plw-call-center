/*
# US campaign: no-transfer claim (no transfer_uri, no live-staff gate)

1. Plain-English explanation
   The US flow no longer transfers calls to a live agent (Anna never hands the call to
   anyone; the only closing is a PLW callback within 24 hours). The live SQL still required
   a `transfer_uri` on the runtime row and an active phone presence for agent-2 before
   claiming a lead; both would block the campaign forever. This migration rewrites the three
   SQL guards that mention a transfer route, keeping every other protection unchanged.

2. Functions replaced (CREATE OR REPLACE, same signatures — nothing dropped)
   - `claim_us_call(p_now timestamptz)`: keeps the transactional advisory lock, runtime row
     lock, scheduler/pause/agent/number/verification gates, the in-flight `max_lines` cap,
     the daily counter and cap, the DNC exclusion, the per-business IANA calling window
     (`us_window_open`), fresh-leads-only selection, no-pending-callback filter, call
     insertion and the dialed counters. REMOVED: the `transfer_uri IS NULL` condition and
     the agent-2 `staff_presence` heartbeat requirement (a live agent no longer takes
     Anna's calls). The claim records staff 'agent-2' (Alejandro) as the campaign owner of
     record; Anna books his follow-up, never a live transfer.
   - `control_us_dialer(p_action text)`: the 'start' action no longer demands
     `transfer_uri IS NULL`-style route config; it keeps the admin-only check, agent id,
     US number, voice verification and scheduler-ready gates, and the pause/start behavior.
   - `reserve_us_test(p_id uuid, p_phone text)`: the test reservation no longer demands
     `transfer_uri`; it keeps the admin-only check, US-phone classification, advisory lock,
     idempotent request id, DNC block, one-active-call-per-phone and runtime gates.

3. Security
   - All three stay SECURITY DEFINER with `SET search_path TO 'public', 'pg_temp'`.
   - Grants are unchanged (already granted to authenticated where applicable); this
     migration alters no privileges.

4. Notes
   - Additive and re-runnable: only CREATE OR REPLACE with identical signatures.
   - No data is read, written or deleted; campaign state, numbers, history and pause stay.
*/

CREATE OR REPLACE FUNCTION public.claim_us_call(p_now timestamptz DEFAULT now())
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
  -- The campaign owner of record; Anna's agreed callbacks land on his Hoy list.
  v_staff text := 'agent-2';
BEGIN
  -- Same lock as claim_tourism_call and reserve_tourism_test: one claim at a time on the line.
  PERFORM pg_advisory_xact_lock(72104104);
  SELECT * INTO v_runtime FROM public.us_dialer_runtime WHERE id = 1 FOR UPDATE;
  IF v_runtime.paused OR NOT v_runtime.scheduler_ready OR v_runtime.provider_agent_id IS NULL
     OR v_runtime.caller_e164 IS NULL
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

CREATE OR REPLACE FUNCTION public.control_us_dialer(p_action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_runtime public.us_dialer_runtime%ROWTYPE;
v_staff text := public.current_staff_id();
BEGIN
IF v_staff IS NULL OR NOT public.is_admin() THEN
RAISE EXCEPTION 'No autorizado.';
END IF;
SELECT * INTO v_runtime FROM public.us_dialer_runtime WHERE id = 1 FOR UPDATE;
IF p_action = 'pause' THEN
UPDATE public.us_dialer_runtime SET paused = true, updated_at = now() WHERE id = 1;
RETURN false;
ELSIF p_action = 'start' THEN
IF v_runtime.provider_agent_id IS NULL OR v_runtime.caller_e164 IS NULL
OR v_runtime.config_verified_at IS NULL
OR NOT v_runtime.scheduler_ready THEN
RAISE EXCEPTION 'Configuración incompleta: falta el número de EE. UU. o la verificación de voz.';
END IF;
UPDATE public.us_dialer_runtime
SET paused = false, started_at = now(), started_by = v_staff, updated_at = now()
WHERE id = 1;
RETURN true;
END IF;
RAISE EXCEPTION 'Acción no válida.';
END $function$;

CREATE OR REPLACE FUNCTION public.reserve_us_test(p_id uuid, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF r.config_verified_at IS NULL OR r.provider_agent_id IS NULL THEN
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
END $function$;