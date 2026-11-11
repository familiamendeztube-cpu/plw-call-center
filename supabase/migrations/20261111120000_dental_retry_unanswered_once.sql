-- Owner's rule (2026-11-11): a dentist who didn't pick up gets ONE more call from Anna on a
-- later business day. Eligible: the first call's outcome was NO_ANSWER, or it failed with
-- SIP 480 (phone off / unreachable), 486 (busy) or 408 (timeout). Never retried: 404 (number
-- doesn't exist), voicemail (goes to the agent as "Volver a llamar"), wrong number, opt-outs,
-- conversations, and failures without a recorded reason. A retry counts as a pilot attempt.
-- Two calls per dentist at most, enforced by a unique index, not only by this code.
--
-- claim_dental_call below is the LIVE definition read on 2026-11-11 (it has dial_hold_reason,
-- which the repository's migrations never added), plus the retry step and the attempt number.
-- Safe to re-run.
ALTER TABLE public.dental_leads ADD COLUMN IF NOT EXISTS dial_hold_reason text;
ALTER TABLE public.dental_calls
  ADD COLUMN IF NOT EXISTS attempt smallint NOT NULL DEFAULT 1 CHECK (attempt IN (1, 2));
CREATE UNIQUE INDEX IF NOT EXISTS dental_two_attempts_per_lead ON public.dental_calls (lead_id, attempt);
DROP INDEX IF EXISTS public.dental_one_attempt_per_lead;

CREATE OR REPLACE FUNCTION public.claim_dental_call(p_staff_id text, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d dental_agent_dialers;l dental_leads;c dental_calls;v_local timestamp;v_attempt smallint:=1;
BEGIN
PERFORM pg_advisory_xact_lock(72104102);
SELECT * INTO d FROM dental_agent_dialers WHERE staff_id=p_staff_id FOR UPDATE;
IF NOT FOUND OR d.state<>'running' OR d.config_verified_at IS NULL OR (d.transfer_verified_at IS NULL AND d.pilot_call_limit IS NULL) OR d.provider_agent_id IS NULL OR d.caller_phone_number_id IS NULL OR d.voice_id IS NULL OR d.transfer_uri IS NULL THEN RETURN NULL;END IF;
IF d.pilot_call_limit IS NOT NULL AND
(SELECT count(*) FROM dental_calls WHERE staff_id=p_staff_id AND NOT is_test)>=d.pilot_baseline_count+d.pilot_call_limit THEN
IF NOT EXISTS(SELECT 1 FROM dental_calls WHERE staff_id=p_staff_id AND NOT is_test AND state='reserved') THEN
UPDATE dental_agent_dialers SET state='paused',last_error='Piloto terminado: límite de intentos alcanzado. Revisar resultados antes de continuar.',updated_at=now() WHERE staff_id=p_staff_id;
END IF;
RETURN NULL;
END IF;
v_local:=p_now AT TIME ZONE 'America/Costa_Rica';
IF extract(isodow FROM v_local)>5 OR v_local::time<time '09:00' OR v_local::time>=time '17:00' THEN RETURN NULL;END IF;
IF NOT EXISTS(SELECT 1 FROM staff_profiles s JOIN staff_presence p ON p.staff_id=s.id WHERE s.id=p_staff_id AND s.is_enabled AND s.role='agent' AND p.availability='active' AND p.operational IS NULL AND p.last_heartbeat_at BETWEEN p_now-interval '90 seconds' AND p_now+interval '5 seconds') THEN RETURN NULL;END IF;
IF (SELECT count(*) FROM dental_calls WHERE state IN ('reserved','started','uncertain'))>=4 OR (SELECT count(*) FROM dental_calls WHERE staff_id=p_staff_id AND state IN ('reserved','started','uncertain'))>=2 THEN RETURN NULL;END IF;
-- Due retries first: few, and the oldest unanswered dentist waits longest.
SELECT dl.* INTO l FROM dental_leads dl JOIN dental_calls f ON f.lead_id=dl.id AND f.attempt=1
WHERE dl.owner_staff_id=p_staff_id AND dl.status='pending' AND dl.dial_hold_reason IS NULL
AND (f.outcome='NO_ANSWER' OR (f.state='failed' AND f.error ~ 'SIP (480|486|408)'))
AND (f.created_at AT TIME ZONE 'America/Costa_Rica')::date < v_local::date
AND NOT EXISTS(SELECT 1 FROM dental_calls r WHERE r.lead_id=dl.id AND r.attempt=2)
AND NOT EXISTS(SELECT 1 FROM ai_outbound_do_not_call WHERE phone=dl.phone)
AND NOT EXISTS(SELECT 1 FROM dental_calls a WHERE a.phone=dl.phone AND a.state IN ('reserved','started','uncertain'))
ORDER BY f.created_at,dl.id LIMIT 1 FOR UPDATE OF dl SKIP LOCKED;
IF FOUND THEN
v_attempt:=2;
ELSE
SELECT dl.* INTO l FROM dental_leads dl JOIN dental_campaigns dc ON dc.id=dl.campaign_id WHERE dl.owner_staff_id=p_staff_id AND dl.status='pending' AND dl.dial_hold_reason IS NULL AND (dc.planned_start_at IS NULL OR dc.planned_start_at<=p_now) AND NOT EXISTS(SELECT 1 FROM ai_outbound_do_not_call WHERE phone=dl.phone) AND NOT EXISTS(SELECT 1 FROM dental_calls WHERE lead_id=dl.id OR(phone=dl.phone AND state IN ('reserved','started','uncertain'))) ORDER BY dl.province,dl.canton,dl.business_name,dl.id LIMIT 1 FOR UPDATE OF dl SKIP LOCKED;
IF NOT FOUND THEN RETURN NULL;END IF;
END IF;
INSERT INTO dental_calls(lead_id,staff_id,phone,provider_agent_id,transfer_uri,attempt) VALUES(l.id,p_staff_id,l.phone,d.provider_agent_id,d.transfer_uri,v_attempt) RETURNING * INTO c;
RETURN jsonb_build_object('call',to_jsonb(c),'lead',to_jsonb(l),'route',to_jsonb(d));
END $function$;
