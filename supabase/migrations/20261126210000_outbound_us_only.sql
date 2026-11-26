/*
# Every outbound call goes to the US

Owner decision 2026-11-26: agents and AI call only the US; Costa Rica calls still come in.
Agents' phones are limited in the app and on the phone server (infra/asterisk/telnyx). Here the
Costa Rica AI dialer (Anna Turismo) stops:

1. Paused, and its 10-second tick (cron plw-tourism-dialer) removed. It had no leads left but
   was still running, so a new tourism list would have started calling Costa Rica.
2. control_tourism_dialer refuses 'start' (pause still works) and reserve_tourism_test refuses
   test calls, with a message the admin card shows.

Nothing is deleted: leads, calls, callbacks, settings and the ElevenLabs agent stay. To bring
it back, restore control_tourism_dialer and reserve_tourism_test from
20261119200000_tourism_dialer_fixes.sql / 20261123134254_tourism_test_rpc_authenticated_grant.sql and press
Configurar (it schedules the tick again).
*/

UPDATE public.tourism_dialer_runtime
SET paused = true, scheduler_ready = false, updated_at = now()
WHERE id = 1;

SELECT cron.unschedule('plw-tourism-dialer')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'plw-tourism-dialer');

CREATE OR REPLACE FUNCTION public.control_tourism_dialer(p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Solo administración puede controlar el marcador.'; END IF;
  PERFORM pg_advisory_xact_lock(72104104);
  IF p_action = 'start' THEN
    RAISE EXCEPTION 'Las llamadas salientes ahora son solo a EE. UU.: el marcador de Costa Rica quedó apagado.';
  ELSIF p_action = 'pause' THEN
    UPDATE tourism_dialer_runtime SET paused = true, updated_at = now() WHERE id = 1;
  ELSE
    RAISE EXCEPTION 'Acción no válida.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reserve_tourism_test(p_id uuid, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Solo administración.'; END IF;
  RAISE EXCEPTION 'Las llamadas salientes ahora son solo a EE. UU.: use la llamada de prueba de Anna EE. UU.';
END $$;
