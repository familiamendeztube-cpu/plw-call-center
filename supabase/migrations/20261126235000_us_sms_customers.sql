-- US customers text by SMS, not WhatsApp (owner, 2026-11-26). Texts go to and from PLW's US
-- number (+1 754-799-1065) through Telnyx; the us-sms server function talks to Telnyx.
--
-- Rule (owner): an agent may text a customer only after that customer texted PLW first, and never
-- after the customer's latest text was STOP. The admin's sample-link text to a dialer lead
-- (us_sms_send) follows the same rule.
--
-- What this adds:
-- - sms_messages: each customer's texts, both directions. Agents read the texts of the customers
--   they can open (can_access_prospect); only the server writes.
-- - record_sms_received (server): stores an incoming text on the customer with that number (the
--   one already texting, else the newest customer with that phone), or creates a customer through
--   intake (round-robin to an active agent, like WhatsApp and email), and marks the customer unread.
-- - register_sms_reply (agent): checks the rule and the agent's access, and records the reply
--   before the server sends it; repeating the same idempotency key returns the first record.
-- - mark_sms_read (agent): clears the customer's unread mark once the texts are on screen.

CREATE TABLE IF NOT EXISTS public.sms_messages (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  -- The customer's number: who wrote, or who the reply went to.
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+1[2-9][0-9]{9}$'),
  body text NOT NULL CHECK (char_length(body) <= 1600),
  status text NOT NULL CHECK (status IN ('received', 'queued', 'sent', 'delivered', 'failed', 'suppressed')),
  error text NOT NULL DEFAULT '' CHECK (char_length(error) <= 300),
  -- An incoming STOP (or baja): no more texts to that number until it writes again.
  is_stop boolean NOT NULL DEFAULT false,
  provider_message_id text UNIQUE,
  staff_id text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  idempotency_key text UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 120),
  -- The real clock, not the transaction's start: "the latest text" must be exact (e.g. STOP and
  -- a new text recorded close together).
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS sms_messages_prospect_idx ON public.sms_messages (prospect_id, created_at);
CREATE INDEX IF NOT EXISTS sms_messages_phone_idx ON public.sms_messages (phone_e164, created_at);

ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sms_messages_read ON public.sms_messages;
CREATE POLICY sms_messages_read ON public.sms_messages FOR SELECT TO authenticated
  USING (public.can_access_prospect(prospect_id));
REVOKE ALL ON public.sms_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sms_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sms_messages TO service_role;

-- Whether a number may be texted: it texted PLW, and its latest text was not STOP.
CREATE OR REPLACE FUNCTION public.sms_number_open(p_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT COALESCE((
    SELECT NOT m.is_stop FROM public.sms_messages m
    WHERE m.phone_e164 = p_phone AND m.direction = 'in'
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ), false)
$$;
REVOKE ALL ON FUNCTION public.sms_number_open(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_sms_received(
  p_from text,
  p_body text,
  p_provider_message_id text,
  p_stop boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_digits text := public.phone_key(p_from);
  v_prospect uuid;
BEGIN
  IF COALESCE(p_from, '') !~ '^\+1[2-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'Número de EE. UU. no válido.';
  END IF;
  -- One number at a time: a customer's first two texts cannot create two customers.
  PERFORM pg_advisory_xact_lock(2222, hashtext(p_from));
  -- Telnyx retries webhooks: a text already stored is not stored twice.
  SELECT m.prospect_id INTO v_prospect FROM public.sms_messages m
  WHERE m.provider_message_id = p_provider_message_id;
  IF FOUND THEN
    RETURN v_prospect;
  END IF;

  SELECT m.prospect_id INTO v_prospect FROM public.sms_messages m
  WHERE m.phone_e164 = p_from
  ORDER BY m.created_at DESC
  LIMIT 1;
  IF v_prospect IS NULL THEN
    -- ponytail: several customers with one number go to the newest; WhatsApp also compares names.
    SELECT p.id INTO v_prospect FROM public.prospects p
    WHERE NOT p.is_test AND public.phone_key(p.phone) = v_digits
    ORDER BY p.created_at DESC
    LIMIT 1;
  END IF;
  IF v_prospect IS NULL THEN
    v_prospect := public.intake_inquiry(
      format('(%s) %s-%s', substr(v_digits, 1, 3), substr(v_digits, 4, 3), substr(v_digits, 7)),
      '', '', p_from, '', '', 'sms', NULL, false, 'sms:' || p_from, NULL
    );
  END IF;

  INSERT INTO public.sms_messages (prospect_id, direction, phone_e164, body, status, is_stop, provider_message_id)
  VALUES (v_prospect, 'in', p_from, left(COALESCE(p_body, ''), 1600), 'received', COALESCE(p_stop, false),
          p_provider_message_id);

  -- The unread mark the agent's customer list already shows.
  UPDATE public.conversations
  SET unread = true, last_message_at = now(), status = 'waiting_agent'
  WHERE prospect_id = v_prospect;
  RETURN v_prospect;
END;
$$;
REVOKE ALL ON FUNCTION public.record_sms_received(text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sms_received(text, text, text, boolean) TO service_role;

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
  IF char_length(v_body) NOT BETWEEN 1 AND 1600 THEN
    RAISE EXCEPTION 'Escriba un mensaje de 1 a 1600 caracteres.';
  END IF;
  IF COALESCE(char_length(p_idempotency_key), 0) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Solicitud no válida.';
  END IF;
  SELECT m.id, m.status, m.phone_e164 INTO v_existing FROM public.sms_messages m
  WHERE m.idempotency_key = p_idempotency_key AND m.prospect_id = p_prospect_id;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_existing.id, 'status', v_existing.status,
                              'to', v_existing.phone_e164, 'reused', true);
  END IF;

  -- The reply goes to the number the customer last texted from.
  SELECT m.phone_e164 INTO v_phone FROM public.sms_messages m
  WHERE m.prospect_id = p_prospect_id AND m.direction = 'in'
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Este cliente todavía no le ha escrito por SMS a PLW. Solo puede escribirle después de que el cliente escriba primero.';
  END IF;
  IF NOT public.sms_number_open(v_phone) THEN
    RAISE EXCEPTION 'El cliente pidió no recibir más mensajes (STOP). Podrá escribirle si vuelve a escribir.';
  END IF;

  INSERT INTO public.sms_messages (prospect_id, direction, phone_e164, body, status, staff_id, idempotency_key)
  VALUES (p_prospect_id, 'out', v_phone, v_body, 'queued', public.current_staff_id(), p_idempotency_key)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'status', 'queued', 'to', v_phone, 'reused', false);
END;
$$;
REVOKE ALL ON FUNCTION public.register_sms_reply(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_sms_reply(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_sms_read(p_prospect_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'Cliente no disponible.' USING ERRCODE = '42501';
  END IF;
  -- ponytail: like WhatsApp, this also clears an unread email of the same customer.
  UPDATE public.conversations SET unread = false WHERE prospect_id = p_prospect_id AND unread;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_sms_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_sms_read(uuid) TO authenticated;

-- The admin's sample-link text to a dialer lead: same rule, only to a number that texted first.
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
  v_status := CASE WHEN public.sms_number_open(v_to) THEN 'queued' ELSE 'suppressed' END;
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
