/*
# US campaign on Telnyx (calls and SMS)

Owner decision 2026-11-26: the whole US setup runs on the Telnyx number, no Twilio.

1. Calls. Anna's US calls leave ElevenLabs on the Telnyx number imported there (SIP trunk to
   the PLW phone server, which dials out through Telnyx; infra/asterisk/telnyx). Its ElevenLabs
   id is kept in `us_dialer_runtime.phone_number_id`; Configurar finds it from the US number.
   The Costa Rica line (`ai_outbound_settings.caller_phone_number_id`) is no longer used for US
   calls.
2. SMS. Sent from the same Telnyx number with the Telnyx Messaging API. Twilio-only fields go:
   `us_market_settings` (never used: no screen wrote it) and
   `us_sms_messages.messaging_service_sid`. `provider_sid` becomes `provider_message_id` (a
   Telnyx message id) on both SMS tables.
3. `us_sms_send` loses its Twilio service parameter.

All US tables are empty, so nothing is migrated.
*/

ALTER TABLE public.us_dialer_runtime
  ADD COLUMN IF NOT EXISTS phone_number_id text CHECK (char_length(phone_number_id) BETWEEN 1 AND 120);

DROP TABLE IF EXISTS public.us_market_settings;
ALTER TABLE public.us_sms_messages DROP COLUMN IF EXISTS messaging_service_sid;
ALTER TABLE public.us_sms_messages RENAME COLUMN provider_sid TO provider_message_id;
ALTER TABLE public.us_sms_inbound RENAME COLUMN provider_sid TO provider_message_id;

DROP FUNCTION IF EXISTS public.us_sms_send(uuid, text, text, text, text, text, text, uuid);
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
  v_status := CASE WHEN v_lead.sms_consent AND v_lead.sms_mobile <> '' THEN 'queued' ELSE 'suppressed' END;
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
