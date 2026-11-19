-- Recovered on 2026-11-19 from the live database (supabase_migrations.schema_migrations,
-- version 20261119024826). It was applied through Bolt but never committed; kept verbatim.
-- Dental campaign retirement (reversible): stop the scheduler, fail closed every
-- start/resume/dispatch/test path, keep history, webhooks, recordings and auth intact.
-- To reverse: re-apply 20261110151741, 20261110091000 and 20261112100000 definitions.

DO $$
BEGIN
  -- 1. Unschedule the dental dispatcher cron (tourism job untouched).
  PERFORM cron.unschedule('plw-dental-dialer');

  -- 2. Mark the dental scheduler stopped so any in-flight tick no-ops.
  UPDATE dental_dialer_runtime SET scheduler_ready = false WHERE id = 1;

  -- 3. Park every dental agent dialer (claim requires state='running').
  UPDATE dental_agent_dialers SET state = 'stopped', updated_at = now() WHERE state <> 'stopped';
END $$;

-- 4. Scheduler can never be re-enabled until the retirement is reversed.
CREATE OR REPLACE FUNCTION public.enable_dental_scheduler() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION 'La campaña dental fue retirada del uso activo.';
END $$;

-- 5. Activate/resume now fails closed; pause/stop keep working for the UI.
CREATE OR REPLACE FUNCTION public.control_dental_dialer(p_staff_id text,p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d dental_agent_dialers;r dental_dialer_runtime;
BEGIN
 IF NOT is_admin() THEN RAISE EXCEPTION 'Solo administración puede controlar el marcador.';END IF;
 PERFORM pg_advisory_xact_lock(72104102);
 IF p_action IN ('activate','resume') THEN
  RAISE EXCEPTION 'La campaña dental fue retirada del uso activo. Las historias y grabaciones se conservan.';
 END IF;
 SELECT * INTO d FROM dental_agent_dialers WHERE staff_id=p_staff_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Falta configurar el marcador de este agente.';END IF;
 IF p_action IN ('pause','stop') THEN UPDATE dental_agent_dialers SET state=CASE p_action WHEN 'pause' THEN 'paused' ELSE 'stopped' END,updated_at=now() WHERE staff_id=p_staff_id;
 ELSE RAISE EXCEPTION 'Acción no válida.';END IF;
END $$;

-- 6. Batch start and manual test reservations fail closed.
CREATE OR REPLACE FUNCTION public.start_next_dental_batch(p_staff_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Solo administración puede controlar el marcador.'; END IF;
  RAISE EXCEPTION 'La campaña dental fue retirada del uso activo.';
END $$;

CREATE OR REPLACE FUNCTION public.reserve_dental_test(p_id uuid,p_staff_id text,p_phone text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Solo administración.'; END IF;
  RAISE EXCEPTION 'La campaña dental fue retirada del uso activo.';
END $$;

CREATE OR REPLACE FUNCTION public.reserve_dental_ana_test(p_id uuid, p_staff_id text, p_phone text, p_business_name text, p_business_type text, p_contact_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Solo administración.'; END IF;
  RAISE EXCEPTION 'La campaña dental fue retirada del uso activo.';
END $$;
