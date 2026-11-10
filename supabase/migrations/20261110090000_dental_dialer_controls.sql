CREATE TABLE dental_agent_dialers (
 staff_id text PRIMARY KEY REFERENCES staff_profiles(id),provider_agent_id text UNIQUE,caller_phone_number_id text,voice_id text,
 transfer_uri text CHECK(transfer_uri ~ '^sips?:[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+$'),config_verified_at timestamptz,transfer_verified_at timestamptz,
 state text NOT NULL DEFAULT 'stopped' CHECK(state IN ('running','paused','stopped')),last_error text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dental_dialer_runtime(id integer PRIMARY KEY CHECK(id=1),last_tick_at timestamptz,scheduler_ready boolean NOT NULL DEFAULT false,last_error text NOT NULL DEFAULT '');
INSERT INTO dental_dialer_runtime(id) VALUES(1);
CREATE TABLE dental_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES dental_leads(id),is_test boolean NOT NULL DEFAULT false,
 staff_id text NOT NULL REFERENCES staff_profiles(id),phone text NOT NULL CHECK(phone ~ '^[2-8][0-9]{7}$'),provider_agent_id text NOT NULL,transfer_uri text NOT NULL,
 conversation_id text UNIQUE,state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','started','uncertain','completed','failed','cancelled')),
 transcript jsonb NOT NULL DEFAULT '[]',summary text NOT NULL DEFAULT '',transfer_status text NOT NULL DEFAULT 'none' CHECK(transfer_status IN ('none','requested','agent_confirmed','failed')),
 transfer_confirmed_at timestamptz,error text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,synced_at timestamptz,
 CHECK((is_test AND lead_id IS NULL) OR (NOT is_test AND lead_id IS NOT NULL))
);
CREATE UNIQUE INDEX dental_one_attempt_per_lead ON dental_calls(lead_id);
CREATE UNIQUE INDEX dental_one_active_phone ON dental_calls(phone) WHERE state IN ('reserved','started','uncertain');
CREATE INDEX dental_calls_staff_created ON dental_calls(staff_id,created_at DESC);
ALTER TABLE dental_agent_dialers ENABLE ROW LEVEL SECURITY;
ALTER TABLE dental_dialer_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE dental_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dental_agent_dialers,dental_dialer_runtime,dental_calls FROM anon,authenticated;
GRANT SELECT ON dental_agent_dialers,dental_dialer_runtime,dental_calls TO authenticated;
GRANT ALL ON dental_agent_dialers,dental_dialer_runtime,dental_calls TO service_role;
GRANT SELECT,INSERT ON ai_outbound_do_not_call TO service_role;
CREATE POLICY dental_dialers_read ON dental_agent_dialers FOR SELECT TO authenticated USING(is_admin() OR staff_id=current_staff_id());
CREATE POLICY dental_runtime_read ON dental_dialer_runtime FOR SELECT TO authenticated USING(current_staff_id() IS NOT NULL);
CREATE POLICY dental_calls_read ON dental_calls FOR SELECT TO authenticated USING(is_admin() OR staff_id=current_staff_id());
CREATE FUNCTION control_dental_dialer(p_staff_id text,p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d dental_agent_dialers;r dental_dialer_runtime;
BEGIN
 IF NOT is_admin() THEN RAISE EXCEPTION 'Solo administración puede controlar el marcador.';END IF;
 PERFORM pg_advisory_xact_lock(72104102);
 SELECT * INTO d FROM dental_agent_dialers WHERE staff_id=p_staff_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Falta configurar el marcador de este agente.';END IF;
 IF p_action IN ('activate','resume') THEN
  SELECT * INTO r FROM dental_dialer_runtime WHERE id=1;
  IF d.config_verified_at IS NULL OR d.transfer_verified_at IS NULL OR d.provider_agent_id IS NULL OR d.caller_phone_number_id IS NULL OR d.voice_id IS NULL OR d.transfer_uri IS NULL OR NOT r.scheduler_ready OR r.last_tick_at IS NULL OR r.last_tick_at<now()-interval '2 minutes' THEN RAISE EXCEPTION 'Falta verificar el servidor, la voz y una transferencia real para este agente.';END IF;
  IF NOT EXISTS(SELECT 1 FROM staff_profiles WHERE id=p_staff_id AND role='agent' AND is_enabled) THEN RAISE EXCEPTION 'El agente no está habilitado.';END IF;
  UPDATE dental_agent_dialers SET state='running',last_error='',updated_at=now() WHERE staff_id=p_staff_id;
 ELSIF p_action IN ('pause','stop') THEN UPDATE dental_agent_dialers SET state=CASE p_action WHEN 'pause' THEN 'paused' ELSE 'stopped' END,updated_at=now() WHERE staff_id=p_staff_id;
 ELSE RAISE EXCEPTION 'Acción no válida.';END IF;
END $$;
CREATE FUNCTION claim_dental_call(p_staff_id text,p_now timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d dental_agent_dialers;l dental_leads;c dental_calls;v_local timestamp;
BEGIN
 PERFORM pg_advisory_xact_lock(72104102);
 SELECT * INTO d FROM dental_agent_dialers WHERE staff_id=p_staff_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'running' OR d.config_verified_at IS NULL OR d.transfer_verified_at IS NULL OR d.provider_agent_id IS NULL OR d.caller_phone_number_id IS NULL OR d.voice_id IS NULL OR d.transfer_uri IS NULL THEN RETURN NULL;END IF;
 v_local:=p_now AT TIME ZONE 'America/Costa_Rica';
 IF extract(isodow FROM v_local)>5 OR v_local::time<time '09:00' OR v_local::time>=time '17:00' THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM staff_profiles s JOIN staff_presence p ON p.staff_id=s.id WHERE s.id=p_staff_id AND s.is_enabled AND s.role='agent' AND p.availability='active' AND p.operational IS NULL AND p.last_heartbeat_at BETWEEN p_now-interval '90 seconds' AND p_now+interval '5 seconds') THEN RETURN NULL;END IF;
 IF (SELECT count(*) FROM dental_calls WHERE state IN ('reserved','started','uncertain'))>=4 OR (SELECT count(*) FROM dental_calls WHERE staff_id=p_staff_id AND state IN ('reserved','started','uncertain'))>=2 THEN RETURN NULL;END IF;
 SELECT dl.* INTO l FROM dental_leads dl JOIN dental_campaigns dc ON dc.id=dl.campaign_id WHERE dl.owner_staff_id=p_staff_id AND dl.status='pending' AND (dc.planned_start_at IS NULL OR dc.planned_start_at<=p_now) AND NOT EXISTS(SELECT 1 FROM ai_outbound_do_not_call WHERE phone=dl.phone) AND NOT EXISTS(SELECT 1 FROM dental_calls WHERE lead_id=dl.id OR(phone=dl.phone AND state IN ('reserved','started','uncertain'))) ORDER BY dl.province,dl.canton,dl.business_name,dl.id LIMIT 1 FOR UPDATE OF dl SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 INSERT INTO dental_calls(lead_id,staff_id,phone,provider_agent_id,transfer_uri) VALUES(l.id,p_staff_id,l.phone,d.provider_agent_id,d.transfer_uri) RETURNING * INTO c;
 RETURN jsonb_build_object('call',to_jsonb(c),'lead',to_jsonb(l),'route',to_jsonb(d));
END $$;
CREATE FUNCTION confirm_dental_transfer(p_call_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c dental_calls;
BEGIN
 UPDATE dental_calls SET transfer_status='agent_confirmed',transfer_confirmed_at=now() WHERE id=p_call_id AND staff_id=current_staff_id() AND transfer_status='requested' RETURNING * INTO c;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solo el agente receptor puede confirmar una transferencia solicitada.';END IF;
 IF c.is_test THEN UPDATE dental_agent_dialers SET transfer_verified_at=now(),updated_at=now() WHERE staff_id=c.staff_id AND provider_agent_id=c.provider_agent_id AND transfer_uri=c.transfer_uri;END IF;
END $$;
REVOKE ALL ON FUNCTION control_dental_dialer(text,text),claim_dental_call(text,timestamptz),confirm_dental_transfer(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION control_dental_dialer(text,text),confirm_dental_transfer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION claim_dental_call(text,timestamptz) TO service_role;
INSERT INTO dental_agent_dialers(staff_id,transfer_uri) SELECT s.id,'sip:'||a.sip_username||'@'||a.sip_domain FROM staff_profiles s JOIN agent_sip_accounts a ON a.staff_id=s.id WHERE s.id IN ('agent-2','agent-3') AND s.role='agent' AND s.is_enabled ON CONFLICT(staff_id) DO NOTHING;
