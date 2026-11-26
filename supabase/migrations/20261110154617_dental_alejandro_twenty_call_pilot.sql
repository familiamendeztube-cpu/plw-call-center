-- PLW: Alejandro only, at most 20 new non-test attempts, two simultaneous.
-- Target backend: meagbbmittuhdgwnhvxa. Apply through migration tooling as one transaction.
-- This does not configure Ana, start the scheduler, activate calls or fabricate verification.
SELECT pg_advisory_xact_lock(72104102);
ALTER TABLE public.dental_agent_dialers
 ADD COLUMN pilot_call_limit integer CHECK(pilot_call_limit BETWEEN 1 AND 20),
 ADD COLUMN pilot_baseline_count bigint NOT NULL DEFAULT 0 CHECK(pilot_baseline_count>=0),
 ADD COLUMN pilot_started_at timestamptz;

CREATE FUNCTION public.guard_dental_pilot_budget() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d dental_agent_dialers;
BEGIN
 IF NEW.is_test THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(72104102);
 SELECT * INTO d FROM dental_agent_dialers WHERE staff_id=NEW.staff_id FOR UPDATE;
 IF d.pilot_call_limit IS NOT NULL AND
   (SELECT count(*) FROM dental_calls WHERE staff_id=NEW.staff_id AND NOT is_test)>=d.pilot_baseline_count+d.pilot_call_limit THEN
   RAISE EXCEPTION 'El piloto alcanzó su límite de intentos.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_dental_pilot_budget() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_dental_pilot_budget BEFORE INSERT ON public.dental_calls
 FOR EACH ROW EXECUTE FUNCTION public.guard_dental_pilot_budget();

CREATE FUNCTION public.finish_dental_pilot_budget() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d dental_agent_dialers;
BEGIN
 IF NEW.is_test OR NEW.state='reserved' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(72104102);
 SELECT * INTO d FROM dental_agent_dialers WHERE staff_id=NEW.staff_id FOR UPDATE;
 IF d.state='running' AND d.pilot_call_limit IS NOT NULL AND
   (SELECT count(*) FROM dental_calls WHERE staff_id=NEW.staff_id AND NOT is_test)>=d.pilot_baseline_count+d.pilot_call_limit AND
   NOT EXISTS(SELECT 1 FROM dental_calls WHERE staff_id=NEW.staff_id AND NOT is_test AND state='reserved') THEN
   UPDATE dental_agent_dialers SET state='paused',last_error='Piloto terminado: límite de intentos alcanzado. Las llamadas iniciadas pueden finalizar.',updated_at=now() WHERE staff_id=NEW.staff_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.finish_dental_pilot_budget() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finish_dental_pilot_budget AFTER UPDATE OF state ON public.dental_calls
 FOR EACH ROW WHEN(OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION public.finish_dental_pilot_budget();

CREATE OR REPLACE FUNCTION claim_dental_call(p_staff_id text,p_now timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d dental_agent_dialers;l dental_leads;c dental_calls;v_local timestamp;
BEGIN
 PERFORM pg_advisory_xact_lock(72104102);
 SELECT * INTO d FROM dental_agent_dialers WHERE staff_id=p_staff_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'running' OR d.config_verified_at IS NULL OR (d.transfer_verified_at IS NULL AND d.pilot_call_limit IS NULL) OR d.provider_agent_id IS NULL OR d.caller_phone_number_id IS NULL OR d.voice_id IS NULL OR d.transfer_uri IS NULL THEN RETURN NULL;END IF;
 -- Reservations, failures and uncertain provider results all consume the pilot budget.
 IF d.pilot_call_limit IS NOT NULL AND
   (SELECT count(*) FROM dental_calls WHERE staff_id=p_staff_id AND NOT is_test)>=d.pilot_baseline_count+d.pilot_call_limit THEN
   -- Do not cancel the final call while it is still waiting to be submitted.
   IF NOT EXISTS(SELECT 1 FROM dental_calls WHERE staff_id=p_staff_id AND NOT is_test AND state='reserved') THEN
     UPDATE dental_agent_dialers SET state='paused',last_error='Piloto terminado: límite de intentos alcanzado. Revisar resultados antes de continuar.',updated_at=now() WHERE staff_id=p_staff_id;
   END IF;
   RETURN NULL;
 END IF;
 v_local:=p_now AT TIME ZONE 'America/Costa_Rica';
 IF extract(isodow FROM v_local)>5 OR v_local::time<time '09:00' OR v_local::time>=time '17:00' THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM staff_profiles s JOIN staff_presence p ON p.staff_id=s.id WHERE s.id=p_staff_id AND s.is_enabled AND s.role='agent' AND p.availability='active' AND p.operational IS NULL AND p.last_heartbeat_at BETWEEN p_now-interval '90 seconds' AND p_now+interval '5 seconds') THEN RETURN NULL;END IF;
 IF (SELECT count(*) FROM dental_calls WHERE state IN ('reserved','started','uncertain'))>=4 OR (SELECT count(*) FROM dental_calls WHERE staff_id=p_staff_id AND state IN ('reserved','started','uncertain'))>=2 THEN RETURN NULL;END IF;
 SELECT dl.* INTO l FROM dental_leads dl JOIN dental_campaigns dc ON dc.id=dl.campaign_id WHERE dl.owner_staff_id=p_staff_id AND dl.status='pending' AND (dc.planned_start_at IS NULL OR dc.planned_start_at<=p_now) AND NOT EXISTS(SELECT 1 FROM ai_outbound_do_not_call WHERE phone=dl.phone) AND NOT EXISTS(SELECT 1 FROM dental_calls WHERE lead_id=dl.id OR(phone=dl.phone AND state IN ('reserved','started','uncertain'))) ORDER BY dl.province,dl.canton,dl.business_name,dl.id LIMIT 1 FOR UPDATE OF dl SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 INSERT INTO dental_calls(lead_id,staff_id,phone,provider_agent_id,transfer_uri) VALUES(l.id,p_staff_id,l.phone,d.provider_agent_id,d.transfer_uri) RETURNING * INTO c;
 RETURN jsonb_build_object('call',to_jsonb(c),'lead',to_jsonb(l),'route',to_jsonb(d));
END $$;

CREATE OR REPLACE FUNCTION control_dental_dialer(p_staff_id text,p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d dental_agent_dialers;r dental_dialer_runtime;
BEGIN
 IF NOT is_admin() THEN RAISE EXCEPTION 'Solo administración puede controlar el marcador.';END IF;
 PERFORM pg_advisory_xact_lock(72104102);
 SELECT * INTO d FROM dental_agent_dialers WHERE staff_id=p_staff_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Falta configurar el marcador de este agente.';END IF;
 IF p_action IN ('activate','resume') THEN
  IF d.pilot_call_limit IS NOT NULL AND
     (SELECT count(*) FROM dental_calls WHERE staff_id=p_staff_id AND NOT is_test)>=d.pilot_baseline_count+d.pilot_call_limit THEN
    RAISE EXCEPTION 'El piloto alcanzó su límite. Revise los resultados antes de preparar otra tanda.';
  END IF;
  SELECT * INTO r FROM dental_dialer_runtime WHERE id=1;
  IF d.config_verified_at IS NULL OR d.provider_agent_id IS NULL OR d.caller_phone_number_id IS NULL OR d.voice_id IS NULL OR d.transfer_uri IS NULL THEN RAISE EXCEPTION 'Falta configurar Ana, su voz, la línea o el destino de transferencia. Pulse Configurar Ana.';END IF;
  IF d.transfer_verified_at IS NULL AND d.pilot_call_limit IS NULL THEN RAISE EXCEPTION 'El agente debe confirmar una transferencia recibida antes de activar llamadas sin límite de piloto.';END IF;
  IF NOT r.scheduler_ready OR r.last_tick_at IS NULL OR r.last_tick_at<now()-interval '2 minutes' OR r.last_tick_at>now()+interval '5 seconds' THEN RAISE EXCEPTION 'El servidor automático aún no tiene una señal reciente. Verifique Configurar Ana y espere la señal del servidor.';END IF;
  IF NOT EXISTS(SELECT 1 FROM staff_profiles WHERE id=p_staff_id AND role='agent' AND is_enabled) THEN RAISE EXCEPTION 'El agente no está habilitado.';END IF;
  UPDATE dental_agent_dialers SET state='running',last_error='',updated_at=now() WHERE staff_id=p_staff_id;
 ELSIF p_action IN ('pause','stop') THEN UPDATE dental_agent_dialers SET state=CASE p_action WHEN 'pause' THEN 'paused' ELSE 'stopped' END,updated_at=now() WHERE staff_id=p_staff_id;
 ELSE RAISE EXCEPTION 'Acción no válida.';END IF;
END $$;

-- Keep existing role boundaries. No browser can reserve or insert calls directly.
REVOKE ALL ON FUNCTION public.claim_dental_call(text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dental_call(text,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.control_dental_dialer(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.control_dental_dialer(text,text) TO authenticated;

-- Prepare the requested batch without initiating it or modifying Valeska.
UPDATE public.dental_agent_dialers SET
 pilot_call_limit=20,
 pilot_baseline_count=(SELECT count(*) FROM public.dental_calls WHERE staff_id='agent-2' AND NOT is_test),
 pilot_started_at=now(),state='stopped',updated_at=now()
WHERE staff_id='agent-2';

-- A real received pilot transfer is evidence too; only the receiving agent can confirm.
CREATE OR REPLACE FUNCTION confirm_dental_transfer(p_call_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c dental_calls;
BEGIN
 UPDATE dental_calls SET transfer_status='agent_confirmed',transfer_confirmed_at=now() WHERE id=p_call_id AND staff_id=current_staff_id() AND transfer_status='requested' RETURNING * INTO c;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solo el agente receptor puede confirmar una transferencia solicitada.';END IF;
 UPDATE dental_agent_dialers SET transfer_verified_at=now(),updated_at=now() WHERE staff_id=c.staff_id AND provider_agent_id=c.provider_agent_id AND transfer_uri=c.transfer_uri;
END $$;
