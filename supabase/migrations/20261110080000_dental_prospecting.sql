-- Version 20261110080000 is already recorded on the live PLW project.
-- This source restores its schema contract for fresh checkouts and tests.
-- Do not rerun it against an existing dental schema.
CREATE TABLE public.dental_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 planned_start_at timestamptz,timezone text NOT NULL DEFAULT 'America/Costa_Rica' CHECK(timezone='America/Costa_Rica'),
 concurrent_per_agent integer NOT NULL DEFAULT 2 CHECK(concurrent_per_agent BETWEEN 1 AND 2),
 automation_status text NOT NULL DEFAULT 'not_configured' CHECK(automation_status IN ('not_configured','paused','scheduled','running','completed')),
 readiness_note text NOT NULL DEFAULT 'Falta configurar y probar la marcación automática y la transferencia a cada agente.',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.dental_leads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),campaign_id uuid NOT NULL REFERENCES dental_campaigns(id),
 phone text NOT NULL UNIQUE CHECK(phone ~ '^[2-8][0-9]{7}$'),business_name text NOT NULL CHECK(length(btrim(business_name)) BETWEEN 1 AND 200),
 contact_name text NOT NULL DEFAULT '' CHECK(length(contact_name)<=200),
 province text NOT NULL DEFAULT '' CHECK(province IN ('','San José','Alajuela','Cartago','Heredia','Guanacaste','Puntarenas','Limón')),
 canton text NOT NULL DEFAULT '' CHECK(length(canton)<=120),address text NOT NULL DEFAULT '' CHECK(length(address)<=700),
 source_url text NOT NULL CHECK(source_url ~ '^https://[^[:space:]]+$' AND length(source_url)<=1500),
 source_name text NOT NULL CHECK(length(source_name) BETWEEN 1 AND 120),source_checked_at date NOT NULL,
 verification text NOT NULL DEFAULT 'directory' CHECK(verification IN ('directory','primary','phone_confirmed')),
 owner_staff_id text REFERENCES staff_profiles(id),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','contacted','interested','callback','not_interested','wrong_number','do_not_call')),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),updated_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dental_leads_owner_status_idx ON dental_leads(owner_staff_id,status);
CREATE INDEX dental_leads_campaign_idx ON dental_leads(campaign_id);
ALTER TABLE dental_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE dental_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dental_campaigns,dental_leads FROM anon,authenticated;
GRANT SELECT ON dental_campaigns,dental_leads TO authenticated;
GRANT ALL ON dental_campaigns,dental_leads TO service_role;
CREATE POLICY dental_leads_read ON dental_leads FOR SELECT TO authenticated USING(is_admin() OR owner_staff_id=current_staff_id());
CREATE POLICY dental_campaigns_read ON dental_campaigns FOR SELECT TO authenticated USING(is_admin() OR EXISTS(SELECT 1 FROM dental_leads l WHERE l.campaign_id=dental_campaigns.id AND l.owner_staff_id=current_staff_id()));
CREATE FUNCTION assign_dental_leads(p_campaign_id uuid,p_staff_ids text[]) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l record; chosen text; n integer:=0;
BEGIN
 IF NOT is_admin() THEN RAISE EXCEPTION 'Solo administración puede asignar.'; END IF;
 IF cardinality(p_staff_ids) IS DISTINCT FROM 2 OR (SELECT count(DISTINCT id) FROM staff_profiles WHERE id=ANY(p_staff_ids) AND role='agent' AND is_enabled)<>2 THEN RAISE EXCEPTION 'Seleccione dos agentes activos diferentes.'; END IF;
 PERFORM pg_advisory_xact_lock(72104101);
 FOR l IN SELECT id FROM dental_leads WHERE campaign_id=p_campaign_id AND owner_staff_id IS NULL AND status='pending' AND NOT EXISTS(SELECT 1 FROM ai_outbound_do_not_call d WHERE d.phone=dental_leads.phone) ORDER BY province,canton,business_name,id FOR UPDATE LOOP
  SELECT s.id INTO chosen FROM staff_profiles s LEFT JOIN dental_leads d ON d.owner_staff_id=s.id AND d.campaign_id=p_campaign_id WHERE s.id=ANY(p_staff_ids) GROUP BY s.id ORDER BY count(d.id),s.id LIMIT 1;
  UPDATE dental_leads SET owner_staff_id=chosen,updated_at=now() WHERE id=l.id;n:=n+1;
 END LOOP;RETURN n;
END $$;
CREATE FUNCTION update_dental_lead(p_id uuid,p_status text,p_notes text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l dental_leads;
BEGIN
 SELECT * INTO l FROM dental_leads WHERE id=p_id AND (is_admin() OR owner_staff_id=current_staff_id()) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contacto no disponible.'; END IF;
 IF (l.status='do_not_call' OR EXISTS(SELECT 1 FROM ai_outbound_do_not_call WHERE phone=l.phone)) AND p_status<>'do_not_call' THEN RAISE EXCEPTION 'Este contacto solicitó no recibir llamadas.'; END IF;
 UPDATE dental_leads SET status=p_status,notes=p_notes,updated_at=now() WHERE id=p_id;
 IF p_status='do_not_call' THEN INSERT INTO ai_outbound_do_not_call(phone,reason) VALUES(l.phone,'Solicitud desde lista dental') ON CONFLICT(phone) DO NOTHING; END IF;
END $$;
REVOKE ALL ON FUNCTION assign_dental_leads(uuid,text[]),update_dental_lead(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION assign_dental_leads(uuid,text[]),update_dental_lead(uuid,text,text) TO authenticated;
CREATE FUNCTION block_dental_phone() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN UPDATE dental_leads SET status='do_not_call',updated_at=now() WHERE phone=NEW.phone;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION block_dental_phone() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER dental_global_opt_out AFTER INSERT ON ai_outbound_do_not_call FOR EACH ROW EXECUTE FUNCTION block_dental_phone();
