-- Recovered 2026-11-26 from the live migration history: Bolt applied this on 2026-11-10 without
-- committing the file. Holds dental leads whose directory name points outside Costa Rica and
-- starts Valeska's 20-call dental pilot (dental campaign retired 2026-11-19).
-- PLW: hold dental leads whose directory name points outside Costa Rica, and start Valeska's bounded first pilot.
-- Lead records and source fields are preserved. Alejandro's baseline, limit and history are not changed.
SELECT pg_advisory_xact_lock(72104102);

ALTER TABLE public.dental_leads
 ADD COLUMN dial_hold_reason text CHECK(dial_hold_reason IS NULL OR length(dial_hold_reason) BETWEEN 1 AND 300);

UPDATE public.dental_leads SET
 dial_hold_reason='El nombre del directorio indica otra ciudad o país. Confirmar la ubicación antes de llamar; el teléfono y la fuente no se modificaron.',
 updated_at=now()
WHERE status='pending' AND dial_hold_reason IS NULL
 AND business_name ~* '(\ylima\y|madrid|miami|\y33185\y|\ybarcelona\y|\bvalencia\y|\bsevilla\y|\bvigo\y)';

CREATE OR REPLACE FUNCTION claim_dental_call(p_staff_id text,p_now timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d dental_agent_dialers;l dental_leads;c dental_calls;v_local timestamp;
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
 SELECT dl.* INTO l FROM dental_leads dl JOIN dental_campaigns dc ON dc.id=dl.campaign_id WHERE dl.owner_staff_id=p_staff_id AND dl.status='pending' AND dl.dial_hold_reason IS NULL AND (dc.planned_start_at IS NULL OR dc.planned_start_at<=p_now) AND NOT EXISTS(SELECT 1 FROM ai_outbound_do_not_call WHERE phone=dl.phone) AND NOT EXISTS(SELECT 1 FROM dental_calls WHERE lead_id=dl.id OR(phone=dl.phone AND state IN ('reserved','started','uncertain'))) ORDER BY dl.province,dl.canton,dl.business_name,dl.id LIMIT 1 FOR UPDATE OF dl SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 INSERT INTO dental_calls(lead_id,staff_id,phone,provider_agent_id,transfer_uri) VALUES(l.id,p_staff_id,l.phone,d.provider_agent_id,d.transfer_uri) RETURNING * INTO c;
 RETURN jsonb_build_object('call',to_jsonb(c),'lead',to_jsonb(l),'route',to_jsonb(d));
END $$;

UPDATE public.dental_agent_dialers SET
 pilot_call_limit=20,
 pilot_baseline_count=(SELECT count(*) FROM public.dental_calls WHERE staff_id='agent-3' AND NOT is_test),
 pilot_started_at=now(),state='stopped',updated_at=now()
WHERE staff_id='agent-3' AND pilot_call_limit IS NULL;
