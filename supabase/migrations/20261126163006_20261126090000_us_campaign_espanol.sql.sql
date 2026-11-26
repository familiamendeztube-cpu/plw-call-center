/*
# Campaña «EE. UU. · Negocios en español» — base aditiva

1. Resumen
   Soporte de base de datos para la campaña de llamadas a EE. UU., separada por completo de
   las campañas de Costa Rica (turismo/dental). Todo es ADITIVO: no se modifica ni borra
   ninguna tabla, columna ni política existente. La ejecución queda APAGADA por defecto
   (runtime pausado, sin número ni credenciales configuradas).

2. Nuevas tablas
   - `us_campaigns`: campañas del mercado US. Se crea la principal «EE. UU. · Negocios en
     español» por su nombre estable.
   - `us_campaign_agents`: qué staff puede sostener llamadas de la campaña US.
   - `us_leads`: prospectos US con teléfono E.164 completo. `phone_e164` guarda el número
     normalizado (aunque no sea US, para dejarlo visible); `dest` clasifica
     ('us','ca','cr','invalid','other','dup','dnc'); CR/inválidos/duplicados/DNC quedan
     visibles y FUERA de cola, sin borrar nada y sin convertir a +1. `consent_ref`/`consent_ref_note`
     registran la referencia de inscripción/acuerdo declarada por el dueño (por fila o lote,
     sin inventar evidencia). `sms_mobile` (móvil autorizado, puede diferir del principal) y
     `sms_consent` (permiso SMS separado del permiso de llamada) soportan el SMS posterior.
   - `us_calls`: llamadas salientes ElevenLabs. `phone` exige E.164 US completo (+1 con área
     y exchange válidos). `ended_reason` distingue humano/buzón/IVR/técnico.
   - `us_callbacks`: devoluciones prometidas con zona IANA del prospecto (ventanas locales
     con DST automáticas vía `AT TIME ZONE`).
   - `us_dialer_runtime`: fila única id=1, PAUSADA por defecto; troncal/identidad USA
     (`caller_e164`), agente ElevenLabs US, `transfer_uri` de la ruta Asterisk USA,
     verificación de configuración y cap diario.
   - `us_sms_messages`: SMS salientes con idempotencia por (lead, clave), ambos enlaces
     (web + secretaria), remitente comercial y estado de entrega real.
   - `us_sms_inbound`: respuestas entrantes (STOP/HELP/texto) con supresión.
   - `us_market_settings`: fila única con identificadores y URLs de webhook visibles al
     admin; SIN secretos (las credenciales Twilio viven solo como secretos de la función).

3. Funciones de clasificación
   - `us_normalize_phone(text)` → E.164 (+1XXXXXXXXXX) o NULL.
   - `classify_us_phone(e164)` → 'us' solo para NANP continental de EE. UU.; Puerto Rico,
     República Dominicana y el Caribe +1, y Canadá, quedan 'other'/'ca'; +506 → 'cr'.

4. RPCs (todas con REVOKE a PUBLIC/anon y grants mínimos)
   - `us_classify_lead_rows(uuid)` (SECURITY DEFINER, solo admin): inventaría filas
     importadas y asigna dest/excluded_reason sin borrar nada.
   - `claim_us_call()` (SECURITY DEFINER, service_role): como `claim_tourism_call`, pero
     con ventana LOCAL del prospecto (zona IANA + DST), DNC/dest antes de llamar, agentes
     por `us_campaign_agents` con presencia fresca, cap diario y UNA llamada in-flight
     global compartida con turismo/dental. Atiende primero devoluciones vencidas.
   - `reserve_us_test(uuid, text)` (SECURITY DEFINER, admin): llamada de prueba admin.
   - `control_us_dialer(text)` (admin): Iniciar/Pausar; Iniciar exige config completa.
   - `us_call_to_customer(uuid)` (service_role): convierte llamada interesada en cliente
     para Alejandro, emparejando por teléfono E.164 COMPLETO (sin el right(8) de CR).
   - `us_sms_send(...)` (service_role): registra el SMS con idempotencia y supresión
     (sin permiso SMS → 'suppressed', visible, nunca enviado).
   - `us_prepare_sample(uuid)` (SECURITY DEFINER, agente dueño): ÚNICO camino a muestra.
     Exige en servidor una llamada humana completada con interés confirmado; reutiliza el
     borrador/token existente de `prospect_site_drafts` (idempotente: doble clic no crea
     nada extra).
   - `us_sms_consent(uuid, text, boolean)` (SECURITY DEFINER, agente dueño): registra el
     móvil autorizado y el permiso SMS separado desde la ficha.
   - `resolve_us_callback` / `reschedule_us_callback` (admin/owner).

5. Seguridad / RLS / grants
   - RLS activado en todas las tablas nuevas; sin escritura directa de navegador salvo
     INSERT admin en `us_leads` (importación), todo lo demás pasa por service_role o RPC.
   - Lectura: staff autenticado ve campañas/leads/callbacks; llamadas/runtime/settings solo
     admin (igual que el patrón de turismo).
   - `service_role` recibe los grants que usan las funciones edge.

6. Notas
   - No se insertan credenciales ni números: todo queda vacío/pendiente y visible en el panel.
   - El cron no se toca: el runner US usa la misma runner key por su propia función.
*/

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.us_campaigns (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 120),
  purpose text NOT NULL DEFAULT '' CHECK (char_length(purpose) <= 1000),
  created_by text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.us_campaigns (name, purpose) VALUES
  ('EE. UU. · Negocios en español',
   'Recepción virtual multilingüe de PLW para negocios de EE. UU. que atienden en español. Anna se identifica como IA, atiende IVR en inglés, cambia de idioma y ofrece muestra solo tras interés humano confirmado.')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.us_campaign_agents (
  campaign_id uuid NOT NULL REFERENCES public.us_campaigns(id) ON DELETE CASCADE,
  staff_id text NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, staff_id)
);
ALTER TABLE public.us_campaign_agents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.us_campaign_agents FROM anon, authenticated;
GRANT SELECT ON public.us_campaign_agents TO authenticated;

CREATE TABLE IF NOT EXISTS public.us_leads (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.us_campaigns(id) ON DELETE CASCADE,
  raw_phone text NOT NULL DEFAULT '' CHECK (char_length(raw_phone) <= 40),
  phone_e164 text CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+1[0-9]{10}$|^\+506[0-9]{8}$'),
  dest text NOT NULL DEFAULT 'invalid' CHECK (dest IN ('us', 'ca', 'cr', 'invalid', 'other', 'dup', 'dnc')),
  contact_name text NOT NULL DEFAULT '' CHECK (char_length(contact_name) <= 120),
  business_name text NOT NULL DEFAULT '' CHECK (char_length(business_name) <= 160),
  business_type text NOT NULL DEFAULT '' CHECK (char_length(business_type) <= 120),
  timezone text NOT NULL DEFAULT 'America/New_York' CHECK (timezone ~ '^[A-Za-z_]+/[A-Za-z_+-]{1,40}$'),
  consent_ref text NOT NULL DEFAULT '' CHECK (char_length(consent_ref) <= 240),
  consent_ref_note text NOT NULL DEFAULT '' CHECK (char_length(consent_ref_note) <= 400),
  sms_mobile text NOT NULL DEFAULT '' CHECK (char_length(sms_mobile) <= 20),
  sms_consent boolean NOT NULL DEFAULT false,
  excluded_reason text NOT NULL DEFAULT '' CHECK (char_length(excluded_reason) <= 240),
  last_call_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS us_leads_queue_idx ON public.us_leads (campaign_id, dest, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS us_leads_campaign_phone_key
  ON public.us_leads (campaign_id, phone_e164) WHERE phone_e164 IS NOT NULL AND dest = 'us';

CREATE TABLE IF NOT EXISTS public.us_calls (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  lead_id uuid REFERENCES public.us_leads(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.us_campaigns(id) ON DELETE SET NULL,
  is_test boolean NOT NULL DEFAULT false,
  staff_id text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  phone text NOT NULL CHECK (phone ~ '^\+1[2-9][0-9]{9}$'),
  provider_agent_id text NOT NULL CHECK (char_length(provider_agent_id) BETWEEN 1 AND 120),
  conversation_id text UNIQUE,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN (
    'reserved', 'started', 'uncertain', 'completed', 'failed', 'cancelled'
  )),
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 6000),
  error text NOT NULL DEFAULT '' CHECK (char_length(error) <= 500),
  ended_reason text CHECK (ended_reason IN ('human', 'voicemail', 'ivr', 'technical')),
  outcome text CHECK (char_length(outcome) <= 60),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  synced_at timestamptz,
  CONSTRAINT us_calls_lead_shape CHECK (
    (is_test AND lead_id IS NULL AND campaign_id IS NULL)
    OR (NOT is_test AND lead_id IS NOT NULL AND campaign_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS us_calls_open_idx ON public.us_calls (state, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS us_calls_one_active_phone ON public.us_calls (phone)
  WHERE state IN ('reserved', 'started', 'uncertain');

CREATE TABLE IF NOT EXISTS public.us_callbacks (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.us_calls(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.us_leads(id) ON DELETE SET NULL,
  phone text NOT NULL CHECK (phone ~ '^\+1[2-9][0-9]{9}$'),
  scheduled_for timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'America/New_York' CHECK (timezone ~ '^[A-Za-z_]+/[A-Za-z_+-]{1,40}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled', 'failed', 'resolved')),
  claimed_at timestamptz,
  promised_at timestamptz,
  fail_reason text NOT NULL DEFAULT '' CHECK (char_length(fail_reason) <= 240),
  resolved_at timestamptz,
  resolved_by text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, phone, scheduled_for)
);
CREATE INDEX IF NOT EXISTS us_callbacks_pending_idx ON public.us_callbacks (status, scheduled_for);

CREATE TABLE IF NOT EXISTS public.us_dialer_runtime (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_tick_at timestamptz,
  scheduler_ready boolean NOT NULL DEFAULT false,
  last_error text NOT NULL DEFAULT '' CHECK (char_length(last_error) <= 300),
  paused boolean NOT NULL DEFAULT true,
  allowed_from time NOT NULL DEFAULT '08:00',
  allowed_to time NOT NULL DEFAULT '16:00',
  checked_at date,
  dialed_today integer NOT NULL DEFAULT 0 CHECK (dialed_today >= 0),
  daily_cap integer NOT NULL DEFAULT 100 CHECK (daily_cap > 0),
  provider_agent_id text,
  caller_e164 text CHECK (caller_e164 IS NULL OR caller_e164 ~ '^\+1[2-9][0-9]{9}$'),
  transfer_uri text,
  config_verified_at timestamptz,
  consecutive_403 integer NOT NULL DEFAULT 0 CHECK (consecutive_403 >= 0),
  started_at timestamptz,
  started_by text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.us_dialer_runtime (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.us_sms_messages (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.us_leads(id) ON DELETE CASCADE,
  call_id uuid REFERENCES public.us_calls(id) ON DELETE SET NULL,
  to_e164 text NOT NULL CHECK (to_e164 ~ '^\+1[2-9][0-9]{9}$'),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 800),
  web_url text NOT NULL DEFAULT '' CHECK (char_length(web_url) <= 300),
  secretary_url text NOT NULL DEFAULT '' CHECK (char_length(secretary_url) <= 300),
  sender_id text NOT NULL DEFAULT '' CHECK (char_length(sender_id) <= 20),
  messaging_service_sid text NOT NULL DEFAULT '' CHECK (char_length(messaging_service_sid) <= 40),
  provider_sid text UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'suppressed')),
  error text NOT NULL DEFAULT '' CHECK (char_length(error) <= 300),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 120),
  created_by text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS us_sms_messages_lead_idx ON public.us_sms_messages (lead_id, created_at);

CREATE TABLE IF NOT EXISTS public.us_sms_inbound (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  lead_id uuid REFERENCES public.us_leads(id) ON DELETE SET NULL,
  from_e164 text NOT NULL CHECK (from_e164 ~ '^\+1[2-9][0-9]{9}$'),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 500),
  suppressed boolean NOT NULL DEFAULT false,
  provider_sid text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS us_sms_inbound_from_idx ON public.us_sms_inbound (from_e164, created_at);

CREATE TABLE IF NOT EXISTS public.us_market_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  messaging_service_sid text NOT NULL DEFAULT '' CHECK (char_length(messaging_service_sid) <= 40),
  sms_sender_id text NOT NULL DEFAULT '' CHECK (char_length(sms_sender_id) <= 20),
  sms_webhook_url text NOT NULL DEFAULT '' CHECK (char_length(sms_webhook_url) <= 300),
  status_webhook_url text NOT NULL DEFAULT '' CHECK (char_length(status_webhook_url) <= 300),
  public_base_url text NOT NULL DEFAULT '' CHECK (char_length(public_base_url) <= 300),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.us_market_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS, grants
-- ---------------------------------------------------------------------------
ALTER TABLE public.us_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.us_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.us_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.us_callbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.us_dialer_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.us_sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.us_sms_inbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.us_market_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.us_campaigns FROM anon, authenticated;
REVOKE ALL ON public.us_campaign_agents FROM anon, authenticated;
REVOKE ALL ON public.us_leads FROM anon, authenticated;
REVOKE ALL ON public.us_calls FROM anon, authenticated;
REVOKE ALL ON public.us_callbacks FROM anon, authenticated;
REVOKE ALL ON public.us_dialer_runtime FROM anon, authenticated;
REVOKE ALL ON public.us_sms_messages FROM anon, authenticated;
REVOKE ALL ON public.us_sms_inbound FROM anon, authenticated;
REVOKE ALL ON public.us_market_settings FROM anon, authenticated;

GRANT SELECT ON public.us_campaigns, public.us_campaign_agents, public.us_leads, public.us_callbacks
  TO authenticated;
GRANT SELECT ON public.us_calls, public.us_dialer_runtime, public.us_market_settings TO authenticated;
GRANT INSERT ON public.us_leads TO authenticated; -- importación admin; la política decide
GRANT SELECT, INSERT, UPDATE ON public.us_calls TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.us_callbacks TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.us_leads TO service_role;
GRANT SELECT, UPDATE ON public.us_dialer_runtime TO service_role;
GRANT SELECT, UPDATE ON public.us_market_settings TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.us_sms_messages TO service_role;
GRANT SELECT, INSERT ON public.us_sms_inbound TO service_role;
GRANT SELECT, UPDATE ON public.us_campaigns TO service_role;

CREATE POLICY "Staff read US campaigns" ON public.us_campaigns
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff read US campaign agents" ON public.us_campaign_agents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin import US leads" ON public.us_leads
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Staff read US leads" ON public.us_leads
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read US calls" ON public.us_calls
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff read US callbacks" ON public.us_callbacks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read US runtime" ON public.us_dialer_runtime
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admin read US market settings" ON public.us_market_settings
  FOR SELECT TO authenticated USING (public.is_admin());
-- us_sms_messages / us_sms_inbound: sin política de navegador; solo service_role.

-- ---------------------------------------------------------------------------
-- Clasificación NANP: no todo +1 es EE. UU.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.us_normalize_phone(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_raw, ''), '\D', '', 'g');
  v_national text;
BEGIN
  IF char_length(v_digits) = 11 AND left(v_digits, 1) = '1' THEN
    v_national := right(v_digits, 10);
  ELSIF char_length(v_digits) = 10 THEN
    v_national := v_digits;
  ELSE
    RETURN NULL;
  END IF;
  IF left(v_national, 1) = '0' OR left(v_national, 1) = '1' THEN RETURN NULL; END IF;
  IF substring(v_national, 4, 1) IN ('0', '1') THEN RETURN NULL; END IF;
  RETURN '+1' || v_national;
END $$;

CREATE OR REPLACE FUNCTION public.classify_us_phone(p_e164 text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_area int;
BEGIN
  IF p_e164 IS NULL THEN RETURN 'invalid'; END IF;
  IF left(p_e164, 4) = '+506' THEN RETURN 'cr'; END IF;
  IF left(p_e164, 2) <> '+1' OR char_length(p_e164) <> 12 THEN RETURN 'other'; END IF;
  v_area := substring(p_e164, 3, 3)::int;
  -- Franja NANP que NO es mercado de EE. UU. para esta campaña: PR, RD y Caribe +1.
  IF v_area IN (787, 939, 809, 829, 849, 242, 246, 264, 268, 284, 340, 345, 473, 649, 664,
                670, 671, 684, 721, 758, 767, 784, 868, 869, 876, 658) THEN
    RETURN 'other';
  END IF;
  -- Canadá: prefijos NANP asignados a Canadá (lista amplia, sin solapar con EE. UU.).
  IF v_area IN (204, 226, 236, 249, 250, 263, 289, 306, 343, 354, 365, 367, 368, 403, 416,
                418, 428, 431, 437, 438, 450, 468, 474, 506, 514, 519, 548, 579, 581, 584,
                587, 604, 613, 639, 647, 683, 705, 709, 742, 753, 778, 780, 782, 807, 819,
                825, 867, 873, 879, 902, 905) THEN
    RETURN 'ca';
  END IF;
  RETURN 'us';
END $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.us_classify_lead_rows(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_row record;
  v_norm text;
  v_dest text;
  v_marked int := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  FOR v_row IN
    SELECT id, raw_phone FROM public.us_leads
    WHERE campaign_id = p_campaign_id AND dest = 'invalid' AND raw_phone <> ''
  LOOP
    v_norm := public.us_normalize_phone(v_row.raw_phone);
    IF v_norm IS NULL THEN
      UPDATE public.us_leads
      SET dest = 'invalid', excluded_reason = 'Teléfono ilegible.', updated_at = now()
      WHERE id = v_row.id;
    ELSE
      v_dest := public.classify_us_phone(v_norm);
      IF v_dest = 'us' AND EXISTS (
        SELECT 1 FROM public.us_leads x
        WHERE x.campaign_id = p_campaign_id AND x.id <> v_row.id
          AND x.phone_e164 = v_norm AND x.dest <> 'dup'
      ) THEN
        v_dest := 'dup';
      END IF;
      UPDATE public.us_leads
      SET phone_e164 = v_norm,
          dest = v_dest,
          excluded_reason = CASE v_dest
            WHEN 'us' THEN ''
            WHEN 'dup' THEN 'Duplicado por número completo.'
            WHEN 'cr' THEN 'Número de Costa Rica: pertenece a las campañas CR, no aquí.'
            WHEN 'ca' THEN 'Número de Canadá: fuera del mercado de esta campaña.'
            WHEN 'other' THEN 'Número NANP fuera de EE. UU. continental.'
            ELSE 'Teléfono ilegible.'
          END,
          updated_at = now()
      WHERE id = v_row.id;
    END IF;
    v_marked := v_marked + 1;
  END LOOP;
  RETURN jsonb_build_object('classified', v_marked);
END $$;

CREATE OR REPLACE FUNCTION public.claim_us_call(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_runtime public.us_dialer_runtime%ROWTYPE;
  v_campaign public.us_campaigns%ROWTYPE;
  v_lead public.us_leads%ROWTYPE;
  v_staff text;
  v_call uuid;
  v_inflight int;
  v_local time;
  v_dow int;
BEGIN
  SELECT * INTO v_runtime FROM public.us_dialer_runtime WHERE id = 1 FOR UPDATE;
  IF v_runtime.paused OR NOT v_runtime.scheduler_ready OR v_runtime.provider_agent_id IS NULL
     OR v_runtime.caller_e164 IS NULL OR v_runtime.transfer_uri IS NULL
     OR v_runtime.config_verified_at IS NULL THEN
    RETURN NULL;
  END IF;

  -- Línea compartida: una sola llamada in-flight en TODAS las campañas.
  SELECT (SELECT count(*) FROM public.us_calls WHERE state IN ('reserved', 'started', 'uncertain'))
       + (SELECT count(*) FROM public.tourism_calls WHERE state IN ('reserved', 'started', 'uncertain'))
       + (SELECT count(*) FROM public.dental_calls WHERE state IN ('reserved', 'started', 'uncertain'))
    INTO v_inflight;
  IF v_inflight > 0 THEN
    RETURN NULL;
  END IF;

  -- Cap diario con día de Costa Rica.
  IF v_runtime.checked_at IS DISTINCT FROM (p_now AT TIME ZONE 'America/Costa_Rica')::date THEN
    UPDATE public.us_dialer_runtime
    SET checked_at = (p_now AT TIME ZONE 'America/Costa_Rica')::date, dialed_today = 0
    WHERE id = 1;
    v_runtime.dialed_today := 0;
  END IF;
  IF v_runtime.dialed_today >= v_runtime.daily_cap THEN
    RETURN NULL;
  END IF;

  SELECT c.* INTO v_campaign FROM public.us_campaigns c
  WHERE c.name = 'EE. UU. · Negocios en español';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Un agente de la campaña con presencia fresca.
  SELECT a.staff_id INTO v_staff
  FROM public.us_campaign_agents a
  JOIN public.staff_presence sp ON sp.staff_id = a.staff_id
  WHERE a.campaign_id = v_campaign.id
    AND sp.availability = 'active'
    AND sp.last_heartbeat_at > p_now - interval '90 seconds'
  LIMIT 1;
  IF v_staff IS NULL THEN
    RETURN NULL;
  END IF;

  -- Primero devoluciones vencidas cuyo horario local siga abierto.
  FOR v_lead IN
    SELECT l.* FROM public.us_callbacks cb
    JOIN public.us_leads l ON l.id = cb.lead_id
    WHERE cb.status = 'pending' AND cb.scheduled_for <= p_now
      AND l.dest = 'us' AND l.phone_e164 IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.us_calls x WHERE x.phone = l.phone_e164
                        AND x.state IN ('reserved', 'started', 'uncertain'))
    ORDER BY cb.scheduled_for
    LIMIT 5
  LOOP
    v_local := (p_now AT TIME ZONE v_lead.timezone)::time;
    v_dow := EXTRACT(ISODOW FROM (p_now AT TIME ZONE v_lead.timezone))::int;
    IF v_dow <= 5 AND v_local >= v_runtime.allowed_from AND v_local < v_runtime.allowed_to THEN
      INSERT INTO public.us_calls (lead_id, campaign_id, staff_id, phone, provider_agent_id, is_test)
      VALUES (v_lead.id, v_campaign.id, v_staff, v_lead.phone_e164, v_runtime.provider_agent_id, false)
      RETURNING id INTO v_call;
      UPDATE public.us_callbacks SET attempts = attempts + 1, claimed_at = p_now
      WHERE lead_id = v_lead.id AND status = 'pending';
      UPDATE public.us_dialer_runtime SET dialed_today = dialed_today + 1 WHERE id = 1;
      RETURN jsonb_build_object(
        'call', jsonb_build_object('id', v_call, 'phone', v_lead.phone_e164,
                                   'provider_agent_id', v_runtime.provider_agent_id,
                                   'is_test', false, 'staff_id', v_staff),
        'lead', jsonb_build_object('id', v_lead.id, 'business_name', v_lead.business_name,
                                   'contact_name', v_lead.contact_name, 'business_type', v_lead.business_type,
                                   'timezone', v_lead.timezone)
      );
    END IF;
  END LOOP;

  -- Después leads nunca llamados dentro de su ventana local (L-V).
  FOR v_lead IN
    SELECT l.* FROM public.us_leads l
    WHERE l.campaign_id = v_campaign.id AND l.dest = 'us' AND l.phone_e164 IS NOT NULL
      AND l.last_call_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.us_calls x WHERE x.lead_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM public.us_callbacks cb WHERE cb.lead_id = l.id AND cb.status = 'pending')
    ORDER BY l.created_at
    LIMIT 20
  LOOP
    v_local := (p_now AT TIME ZONE v_lead.timezone)::time;
    v_dow := EXTRACT(ISODOW FROM (p_now AT TIME ZONE v_lead.timezone))::int;
    CONTINUE WHEN NOT (v_dow <= 5 AND v_local >= v_runtime.allowed_from AND v_local < v_runtime.allowed_to);
    INSERT INTO public.us_calls (lead_id, campaign_id, staff_id, phone, provider_agent_id, is_test)
    VALUES (v_lead.id, v_campaign.id, v_staff, v_lead.phone_e164, v_runtime.provider_agent_id, false)
    RETURNING id INTO v_call;
    UPDATE public.us_leads SET last_call_at = p_now WHERE id = v_lead.id;
    UPDATE public.us_dialer_runtime SET dialed_today = dialed_today + 1 WHERE id = 1;
    RETURN jsonb_build_object(
      'call', jsonb_build_object('id', v_call, 'phone', v_lead.phone_e164,
                                 'provider_agent_id', v_runtime.provider_agent_id,
                                 'is_test', false, 'staff_id', v_staff),
      'lead', jsonb_build_object('id', v_lead.id, 'business_name', v_lead.business_name,
                                 'contact_name', v_lead.contact_name, 'business_type', v_lead.business_type,
                                 'timezone', v_lead.timezone)
    );
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.control_us_dialer(p_action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
       OR v_runtime.transfer_uri IS NULL OR v_runtime.config_verified_at IS NULL
       OR NOT v_runtime.scheduler_ready THEN
      RAISE EXCEPTION 'Configuración incompleta: falta número, ruta o verificación de voz.';
    END IF;
    UPDATE public.us_dialer_runtime
    SET paused = false, started_at = now(), started_by = v_staff, updated_at = now()
    WHERE id = 1;
    RETURN true;
  END IF;
  RAISE EXCEPTION 'Acción no válida.';
END $$;

CREATE OR REPLACE FUNCTION public.reserve_us_test(p_id uuid, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_norm text := public.us_normalize_phone(p_phone);
  v_agent text := (SELECT provider_agent_id FROM public.us_dialer_runtime WHERE id = 1);
  v_call uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  IF v_norm IS NULL OR public.classify_us_phone(v_norm) <> 'us' THEN
    RAISE EXCEPTION 'La llamada de prueba necesita un número de EE. UU. válido (E.164).';
  END IF;
  IF v_agent IS NULL THEN
    RAISE EXCEPTION 'Falta configurar el agente de EE. UU.';
  END IF;
  INSERT INTO public.us_calls (id, is_test, phone, provider_agent_id, staff_id)
  VALUES (p_id, true, v_norm, v_agent, public.current_staff_id())
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_call;
  RETURN jsonb_build_object(
    'call', jsonb_build_object('id', COALESCE(v_call, p_id), 'phone', v_norm,
                               'provider_agent_id', v_agent, 'is_test', true)
  );
END $$;

-- Interesados que pasan a Clientes para Alejandro; empareja por E.164 COMPLETO.
CREATE OR REPLACE FUNCTION public.us_call_to_customer(p_call_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  c public.us_calls%ROWTYPE;
  l public.us_leads%ROWTYPE;
  v_key text;
  v_type text;
  v_prospect uuid;
  v_request uuid;
BEGIN
  SELECT * INTO c FROM public.us_calls WHERE id = p_call_id;
  IF NOT FOUND OR c.is_test OR c.lead_id IS NULL OR c.conversation_id IS NULL
     OR c.finished_at IS NULL OR c.ended_reason IS DISTINCT FROM 'human'
     OR NOT COALESCE(c.outcome IN (
       'APPOINTMENT_CONFIRMED', 'INTERESTED_FOLLOW_UP', 'EMAIL_INFO_REQUESTED',
       'CALLBACK_REQUESTED', 'DEMO_SCHEDULED'
     ), false) THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(1110, hashtext(c.conversation_id));
  SELECT r.id INTO v_request FROM public.ai_call_requests r WHERE r.conversation_id = c.conversation_id;
  IF FOUND THEN
    RETURN v_request;
  END IF;

  SELECT * INTO l FROM public.us_leads WHERE id = c.lead_id;
  v_key := 'us:' || l.id::text;
  v_type := left(COALESCE(NULLIF(l.business_type, ''), 'Negocio EE. UU.'), 120);

  -- Historial sin slice(-8): el emparejamiento usa el número completo.
  SELECT p.id INTO v_prospect FROM public.prospects p
  WHERE p.idempotency_key = v_key OR (NOT p.is_test AND p.phone = l.phone_e164)
  ORDER BY p.idempotency_key IS NOT DISTINCT FROM v_key DESC, p.created_at DESC
  LIMIT 1;

  IF v_prospect IS NULL THEN
    INSERT INTO public.prospects (
      business_name, contact_name, phone, business_category, service_interest,
      source, idempotency_key, owner_id
    )
    VALUES (
      left(COALESCE(NULLIF(l.business_name, ''), 'Negocio de EE. UU.'), 160),
      left(COALESCE(NULLIF(c.details->>'contact_name', ''), l.contact_name), 120),
      l.phone_e164,
      v_type,
      left(COALESCE(c.details->>'interest', ''), 160),
      'ai_call_us',
      v_key,
      c.staff_id
    )
    RETURNING id INTO v_prospect;

    INSERT INTO public.conversations (prospect_id, subject)
    VALUES (v_prospect, left(COALESCE(NULLIF(l.business_name, ''), 'Negocio de EE. UU.'), 200));
    INSERT INTO public.assignment_queue (prospect_id, status, assigned_at, assigned_to)
    VALUES (v_prospect, 'assigned', now(), c.staff_id);
    INSERT INTO public.assignment_history (prospect_id, from_owner_id, to_owner_id, mechanism, reason)
    VALUES (v_prospect, NULL, c.staff_id, 'manual', 'Negocio de EE. UU. que habló con Anna');
    INSERT INTO public.notifications (staff_id, prospect_id, kind, body)
    VALUES (c.staff_id, v_prospect, 'assignment',
            left('Anna dejó un negocio de EE. UU. para usted: ' || l.business_name, 300));
    INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
    VALUES (c.staff_id, v_prospect, 'assignment', left('Cliente de Anna (EE. UU.): ' || l.business_name, 300));
  END IF;

  INSERT INTO public.ai_call_requests (
    conversation_id, prospect_id, caller_phone, callback_phone, customer_name, business_name,
    business_type, reason, preferred_contact, preferred_time, summary, call_started_at, status
  )
  VALUES (
    c.conversation_id, v_prospect, l.phone_e164,
    CASE WHEN COALESCE(c.details->>'callback_phone', '') ~ '^\+1[2-9][0-9]{9}$'
         THEN c.details->>'callback_phone' END,
    left(c.details->>'contact_name', 120), left(l.business_name, 160), v_type,
    left(NULLIF(concat_ws(' · ',
      c.details->>'interest', c.details->>'objections', c.summary), ''), 300),
    'phone', left(COALESCE(c.details->>'callback_date', ''), 40),
    left(c.summary, 600), c.created_at, 'pending'
  )
  ON CONFLICT (conversation_id) DO UPDATE SET summary = EXCLUDED.summary
  RETURNING id INTO v_request;
  RETURN v_request;
END $$;

-- Muestra: SOLO tras conversación humana con interés confirmado; reutiliza borrador/token.
CREATE OR REPLACE FUNCTION public.us_prepare_sample(p_prospect_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_staff text := public.current_staff_id();
  v_call record;
  v_draft uuid;
  v_token text;
  v_slug text;
  v_category text;
  v_existing record;
BEGIN
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  SELECT c.id, l.business_type INTO v_call
  FROM public.us_calls c
  JOIN public.us_leads l ON l.id = c.lead_id
  JOIN public.prospects p ON p.idempotency_key = 'us:' || l.id::text
  WHERE p.id = p_prospect_id AND c.is_test = false
    AND c.ended_reason = 'human' AND c.finished_at IS NOT NULL
    AND c.outcome IN ('APPOINTMENT_CONFIRMED', 'INTERESTED_FOLLOW_UP',
                      'CALLBACK_REQUESTED', 'DEMO_SCHEDULED')
  ORDER BY c.finished_at DESC
  LIMIT 1;
  IF v_call.id IS NULL THEN
    RAISE EXCEPTION 'La muestra se prepara solo cuando una llamada humana confirmó interés.';
  END IF;

  SELECT id, preview_token INTO v_existing FROM public.prospect_site_drafts
  WHERE prospect_id = p_prospect_id;
  IF FOUND THEN
    RETURN jsonb_build_object('draft_id', v_existing.id, 'preview_token', v_existing.preview_token, 'reused', true);
  END IF;

  IF v_call.business_type ~* 'tour|excursi|actividad|operad' THEN
    v_slug := 'plw-tourism-tours';
    v_category := 'tours';
  ELSE
    v_slug := 'plw-tourism-stays';
    v_category := 'lodging';
  END IF;

  INSERT INTO public.prospect_site_drafts (
    prospect_id, site_slug, business_name, locale, category, booking_phone,
    preview_token, created_by
  )
  SELECT p_prospect_id, v_slug, left(NULLIF(p.business_name, ''), 120), 'es-US', v_category,
         p.phone, encode(extensions.gen_random_bytes(24), 'hex'), v_staff
  FROM public.prospects p WHERE p.id = p_prospect_id
  RETURNING id, preview_token INTO v_draft, v_token;

  RETURN jsonb_build_object('draft_id', v_draft, 'preview_token', v_token, 'reused', false);
END $$;

-- Permiso SMS separado + móvil autorizado, desde la ficha.
CREATE OR REPLACE FUNCTION public.us_sms_consent(p_lead_id uuid, p_mobile text, p_consent boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_staff text := public.current_staff_id();
  v_norm text;
BEGIN
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.us_leads l
    JOIN public.prospects p ON p.idempotency_key = 'us:' || l.id::text
    WHERE l.id = p_lead_id AND (p.owner_id = v_staff OR public.is_admin())
  ) THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  v_norm := CASE WHEN p_mobile = '' THEN '' ELSE public.us_normalize_phone(p_mobile) END;
  IF p_consent AND (v_norm IS NULL OR public.classify_us_phone(v_norm) <> 'us') THEN
    RAISE EXCEPTION 'El móvil para SMS debe ser un número de EE. UU. válido.';
  END IF;
  UPDATE public.us_leads
  SET sms_mobile = COALESCE(v_norm, ''), sms_consent = p_consent, updated_at = now()
  WHERE id = p_lead_id;
END $$;

-- Registro idempotente del SMS (la función edge hace el envío real tras este registro).
CREATE OR REPLACE FUNCTION public.us_sms_send(
  p_lead_id uuid,
  p_idempotency_key text,
  p_body text,
  p_web_url text,
  p_secretary_url text,
  p_sender_id text,
  p_service_sid text,
  p_call_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_lead public.us_leads%ROWTYPE;
  v_existing record;
  v_status text;
  v_id uuid;
BEGIN
  SELECT * INTO v_lead FROM public.us_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead no encontrado.';
  END IF;
  SELECT id, status INTO v_existing FROM public.us_sms_messages
  WHERE lead_id = p_lead_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'reused', true);
  END IF;
  v_status := CASE WHEN v_lead.sms_consent AND v_lead.sms_mobile <> '' THEN 'queued' ELSE 'suppressed' END;
  INSERT INTO public.us_sms_messages (
    lead_id, call_id, to_e164, body, web_url, secretary_url, sender_id,
    messaging_service_sid, status, idempotency_key
  ) VALUES (
    p_lead_id, p_call_id,
    CASE WHEN v_lead.sms_mobile ~ '^\+1[2-9][0-9]{9}$' THEN v_lead.sms_mobile ELSE v_lead.phone_e164 END,
    left(p_body, 800), left(p_web_url, 300), left(p_secretary_url, 300),
    left(p_sender_id, 20), left(p_service_sid, 40), v_status, left(p_idempotency_key, 120)
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'status', v_status, 'reused', false);
END $$;

CREATE OR REPLACE FUNCTION public.resolve_us_callback(p_callback_id uuid, p_status text, p_reason text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() AND public.current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  IF p_status NOT IN ('done', 'cancelled', 'failed', 'resolved') THEN
    RAISE EXCEPTION 'Estado no válido.';
  END IF;
  UPDATE public.us_callbacks
  SET status = p_status, fail_reason = left(COALESCE(p_reason, ''), 240),
      resolved_at = now(), resolved_by = public.current_staff_id()
  WHERE id = p_callback_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolución no encontrada o ya resuelta.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reschedule_us_callback(p_callback_id uuid, p_when timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() AND public.current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  UPDATE public.us_callbacks SET scheduled_for = p_when, status = 'pending'
  WHERE id = p_callback_id AND status IN ('pending', 'failed');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolución no encontrada.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Grants de funciones (mínimos, con revokes)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.us_normalize_phone(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.classify_us_phone(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.us_classify_lead_rows(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_us_call(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.control_us_dialer(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reserve_us_test(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.us_call_to_customer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.us_prepare_sample(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.us_sms_consent(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.us_sms_send(uuid, text, text, text, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_us_callback(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reschedule_us_callback(uuid, timestamptz) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.us_normalize_phone(text), public.classify_us_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.us_classify_lead_rows(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_us_call(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.control_us_dialer(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_us_test(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.us_call_to_customer(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.us_prepare_sample(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.us_sms_consent(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.us_sms_send(uuid, text, text, text, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_us_callback(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_us_callback(uuid, timestamptz) TO authenticated;
