CREATE FUNCTION dental_runner_key_valid(p_key text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public,extensions,vault,pg_temp AS $$
 SELECT length(p_key)=64 AND EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='plw_dental_runner_key' AND extensions.digest(decrypted_secret,'sha256')=extensions.digest(p_key,'sha256'));
$$;
CREATE FUNCTION enable_dental_scheduler() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,vault,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='plw_dental_runner_key') THEN PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'plw_dental_runner_key','Dental dispatcher authentication');END IF;
 PERFORM cron.schedule('plw-dental-dialer','10 seconds',$job$SELECT net.http_post(url:='https://meagbbmittuhdgwnhvxa.supabase.co/functions/v1/dental-dialer',headers:=jsonb_build_object('Content-Type','application/json','X-PLW-Runner',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='plw_dental_runner_key')),body:='{"action":"tick"}'::jsonb,timeout_milliseconds:=60000);$job$);
 UPDATE dental_dialer_runtime SET scheduler_ready=true WHERE id=1;
END $$;
CREATE FUNCTION reserve_dental_test(p_id uuid,p_staff_id text,p_phone text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d dental_agent_dialers;c dental_calls;
BEGIN
 PERFORM pg_advisory_xact_lock(72104102);
 SELECT * INTO c FROM dental_calls WHERE id=p_id;
 IF FOUND THEN IF c.staff_id<>p_staff_id OR c.phone<>p_phone OR NOT c.is_test THEN RAISE EXCEPTION 'Solicitud ya utilizada.';END IF;RETURN jsonb_build_object('claimed',false,'call',to_jsonb(c));END IF;
 SELECT * INTO d FROM dental_agent_dialers WHERE staff_id=p_staff_id;
 IF NOT FOUND OR d.config_verified_at IS NULL OR d.provider_agent_id IS NULL OR d.transfer_uri IS NULL OR d.caller_phone_number_id IS NULL THEN RAISE EXCEPTION 'Configure la voz primero.';END IF;
 IF EXISTS(SELECT 1 FROM ai_outbound_do_not_call WHERE phone=p_phone) THEN RAISE EXCEPTION 'Número bloqueado.';END IF;
 IF EXISTS(SELECT 1 FROM dental_calls WHERE phone=p_phone AND state IN ('reserved','started','uncertain')) OR (SELECT count(*) FROM dental_calls WHERE state IN ('reserved','started','uncertain'))>=4 OR (SELECT count(*) FROM dental_calls WHERE staff_id=p_staff_id AND state IN ('reserved','started','uncertain'))>=2 THEN RAISE EXCEPTION 'Hay llamadas pendientes de finalizar.';END IF;
 INSERT INTO dental_calls(id,staff_id,phone,provider_agent_id,transfer_uri,is_test) VALUES(p_id,p_staff_id,p_phone,d.provider_agent_id,d.transfer_uri,true) RETURNING * INTO c;
 RETURN jsonb_build_object('claimed',true,'call',to_jsonb(c),'route',to_jsonb(d),'lead',jsonb_build_object('business_name','Prueba controlada PLW','contact_name','el administrador'));
END $$;
REVOKE ALL ON FUNCTION dental_runner_key_valid(text),enable_dental_scheduler(),reserve_dental_test(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dental_runner_key_valid(text),enable_dental_scheduler(),reserve_dental_test(uuid,text,text) TO service_role;
