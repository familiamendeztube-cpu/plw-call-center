/*
# Campaña EE. UU. — complemento: alertas, conversión de hora local y ajustes del runner

1. Resumen
   Complemento de la migración 20261126090000_us_campaign_espanol: agrega lo que el runner
   y el panel de EE. UU. necesitan y que quedó fuera de la primera migración. Todo aditivo,
   sin tocar campañas CR.

2. Nuevas tablas
   - `us_dialer_alerts`: alertas de pausa automática del marcador EE. UU. (misma mecánica
     que `tourism_dialer_alerts`): legibles por staff autenticado, insertadas por el
     service role, limpiadas solo por admin.

3. Nuevas funciones
   - `us_local_to_utc(p_date, p_clock, p_tz)` (SECURITY DEFINER, service_role): convierte
     una fecha y hora local del prospecto (zona IANA) al instante UTC exacto, respetando
     horario de verano (DST) automáticamente mediante `AT TIME ZONE`. Devuelve NULL si la
     zona o los datos son inválidos. La usa el runner para agendar devoluciones en la hora
     local del negocio, no en la de Costa Rica.

4. Seguridad
   - RLS en `us_dialer_alerts`; grants mínimos (SELECT authenticated, INSERT service_role,
     UPDATE limpiar solo admin).
   - `us_local_to_utc` con REVOKE a PUBLIC/anon y EXECUTE solo a service_role.
*/

CREATE TABLE IF NOT EXISTS public.us_dialer_alerts (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 600),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  cleared_by text REFERENCES public.staff_profiles(id) ON DELETE SET NULL
);
ALTER TABLE public.us_dialer_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.us_dialer_alerts FROM anon, authenticated;
GRANT SELECT ON public.us_dialer_alerts TO authenticated;
GRANT INSERT ON public.us_dialer_alerts TO service_role;
GRANT UPDATE (cleared_at, cleared_by) ON public.us_dialer_alerts TO authenticated;
DROP POLICY IF EXISTS "us dialer alerts readable by staff" ON public.us_dialer_alerts;
CREATE POLICY "us dialer alerts readable by staff" ON public.us_dialer_alerts
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.us_local_to_utc(p_date text, p_clock text, p_tz text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_local timestamp;
  v_utc timestamptz;
BEGIN
  BEGIN
    v_local := (p_date::date + p_clock::time);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  BEGIN
    v_utc := v_local AT TIME ZONE p_tz;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  RETURN v_utc;
END $$;

REVOKE ALL ON FUNCTION public.us_local_to_utc(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.us_local_to_utc(text, text, text) TO service_role;
