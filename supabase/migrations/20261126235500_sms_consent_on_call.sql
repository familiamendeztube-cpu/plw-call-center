-- Who may be texted (owner, correcting 20261126235000): customers who agreed on a call to get
-- texts, and customers who texted PLW. A STOP closes the number until the customer writes again.
--
-- What this changes:
-- - sms_consents: "the customer agreed on a call", recorded by the agent on the SMS tab
--   (record_sms_consent) for the customer's US number, with who and when. Agents read their own
--   customers' records; only the function writes.
-- - sms_number_open(phone, agreed): open when the number agreed on a call (or the caller says it
--   did, e.g. a dialer lead's call consent) or texted PLW, and its latest text was not STOP.
-- - register_sms_reply: texts the number the customer last texted from, else the number they
--   agreed on. The first text to a number ends with who writes and how to stop (carrier rules),
--   and the function returns the exact text to send.
-- - us_sms_send (admin sample link to a dialer lead): the lead's call consent counts again
--   (us_leads.sms_consent with its mobile), as before 20261126235000, and STOP still closes it.

CREATE TABLE IF NOT EXISTS public.sms_consents (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+1[2-9][0-9]{9}$'),
  staff_id text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (prospect_id, phone_e164)
);
CREATE INDEX IF NOT EXISTS sms_consents_phone_idx ON public.sms_consents (phone_e164);

ALTER TABLE public.sms_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sms_consents_read ON public.sms_consents;
CREATE POLICY sms_consents_read ON public.sms_consents FOR SELECT TO authenticated
  USING (public.can_access_prospect(prospect_id));
REVOKE ALL ON public.sms_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sms_consents TO authenticated;
GRANT SELECT, INSERT ON public.sms_consents TO service_role;

DROP FUNCTION IF EXISTS public.sms_number_open(text);
CREATE OR REPLACE FUNCTION public.sms_number_open(p_phone text, p_agreed boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT NOT COALESCE((
      SELECT m.is_stop FROM public.sms_messages m
      WHERE m.phone_e164 = p_phone AND m.direction = 'in'
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ), false)
    AND (
      COALESCE(p_agreed, false)
      OR EXISTS (SELECT 1 FROM public.sms_consents c WHERE c.phone_e164 = p_phone)
      OR EXISTS (SELECT 1 FROM public.sms_messages m WHERE m.phone_e164 = p_phone AND m.direction = 'in')
    )
$$;
REVOKE ALL ON FUNCTION public.sms_number_open(text, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_sms_consent(p_prospect_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_key text;
BEGIN
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'Cliente no disponible.' USING ERRCODE = '42501';
  END IF;
  SELECT public.phone_key(p.phone) INTO v_key FROM public.prospects p WHERE p.id = p_prospect_id;
  IF COALESCE(v_key, '') !~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' THEN
    RAISE EXCEPTION 'El cliente no tiene un número de EE. UU. Corrija el teléfono antes de marcar el permiso.';
  END IF;
  INSERT INTO public.sms_consents (prospect_id, phone_e164, staff_id)
  VALUES (p_prospect_id, '+1' || v_key, public.current_staff_id())
  ON CONFLICT (prospect_id, phone_e164) DO NOTHING;
  RETURN '+1' || v_key;
END;
$$;
REVOKE ALL ON FUNCTION public.record_sms_consent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_sms_consent(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_sms_reply(
  p_prospect_id uuid,
  p_body text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_body text := btrim(COALESCE(p_body, ''));
  v_existing record;
  v_phone text;
  v_id uuid;
BEGIN
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'Cliente no disponible.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(char_length(p_idempotency_key), 0) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Solicitud no válida.';
  END IF;
  SELECT m.id, m.status, m.phone_e164, m.body INTO v_existing FROM public.sms_messages m
  WHERE m.idempotency_key = p_idempotency_key AND m.prospect_id = p_prospect_id;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_existing.id, 'status', v_existing.status,
                              'to', v_existing.phone_e164, 'body', v_existing.body, 'reused', true);
  END IF;

  -- The number the customer last texted from, else the number they agreed on in a call.
  SELECT m.phone_e164 INTO v_phone FROM public.sms_messages m
  WHERE m.prospect_id = p_prospect_id AND m.direction = 'in'
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1;
  IF v_phone IS NULL THEN
    SELECT c.phone_e164 INTO v_phone FROM public.sms_consents c
    WHERE c.prospect_id = p_prospect_id
    ORDER BY c.created_at DESC
    LIMIT 1;
  END IF;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'El cliente todavía no aceptó recibir SMS. Pregúnteselo en una llamada y márquelo en la pestaña SMS.';
  END IF;
  IF NOT public.sms_number_open(v_phone) THEN
    RAISE EXCEPTION 'El cliente pidió no recibir más mensajes (STOP). Podrá escribirle si vuelve a escribir.';
  END IF;

  -- The first text PLW sends a number says who writes and how to stop (carrier rules).
  IF NOT EXISTS (
    SELECT 1 FROM public.sms_messages m
    WHERE m.phone_e164 = v_phone AND m.direction = 'out' AND m.status IN ('queued', 'sent', 'delivered')
  ) THEN
    v_body := v_body || E'\n\nProfessional Latino Workers. Responda STOP para no recibir más mensajes.';
  END IF;
  IF char_length(btrim(COALESCE(p_body, ''))) = 0 OR char_length(v_body) > 1600 THEN
    RAISE EXCEPTION 'Escriba un mensaje de 1 a 1500 caracteres.';
  END IF;

  INSERT INTO public.sms_messages (prospect_id, direction, phone_e164, body, status, staff_id, idempotency_key)
  VALUES (p_prospect_id, 'out', v_phone, v_body, 'queued', public.current_staff_id(), p_idempotency_key)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'status', 'queued', 'to', v_phone, 'body', v_body, 'reused', false);
END;
$$;
REVOKE ALL ON FUNCTION public.register_sms_reply(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_sms_reply(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.us_sms_send(
  p_lead_id uuid,
  p_idempotency_key text,
  p_body text,
  p_web_url text,
  p_secretary_url text,
  p_sender_id text,
  p_call_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_lead public.us_leads%ROWTYPE;
  v_existing record;
  v_status text;
  v_to text;
  v_id uuid;
BEGIN
  SELECT * INTO v_lead FROM public.us_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead no encontrado.';
  END IF;
  SELECT id, status, to_e164 INTO v_existing FROM public.us_sms_messages
  WHERE lead_id = p_lead_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_existing.id, 'status', v_existing.status,
                              'to_e164', v_existing.to_e164, 'reused', true);
  END IF;
  v_to := CASE WHEN v_lead.sms_mobile ~ '^\+1[2-9][0-9]{9}$' THEN v_lead.sms_mobile ELSE v_lead.phone_e164 END;
  IF v_to IS NULL OR v_to !~ '^\+1[2-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'El contacto no tiene un móvil de EE. UU.';
  END IF;
  v_status := CASE
    WHEN public.sms_number_open(v_to, v_lead.sms_consent AND v_lead.sms_mobile <> '') THEN 'queued'
    ELSE 'suppressed'
  END;
  INSERT INTO public.us_sms_messages (
    lead_id, call_id, to_e164, body, web_url, secretary_url, sender_id, status, idempotency_key
  ) VALUES (
    p_lead_id, p_call_id, v_to,
    left(p_body, 800), left(p_web_url, 300), left(p_secretary_url, 300),
    left(p_sender_id, 20), v_status, left(p_idempotency_key, 120)
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'status', v_status, 'to_e164', v_to, 'reused', false);
END $$;

REVOKE ALL ON FUNCTION public.us_sms_send(uuid, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.us_sms_send(uuid, text, text, text, text, text, uuid) TO service_role;
