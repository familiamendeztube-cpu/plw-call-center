/*
# Protect uncertain Gmail sends from automatic resend

1. Changes
- New internal helper `outbox_actor_allowed` checks that the sending agent is still enabled, still owns the conversation, and was not revoked after the item was created.
- `gmail_outbox_claim` rechecks that helper before reconciling a confirming item. If the check fails, the item stays in "Confirmando envío" with a lease renewal and is never sent again.
- `gmail_outbox_settle` never moves a confirming item back to queued or failed. Only a Gmail-confirmed "sent" outcome can leave the confirming state. Any other outcome keeps the item confirming for another reconciliation.

2. Security
- The helper is internal: EXECUTE is revoked from PUBLIC, anon, authenticated and service_role.
- Existing grants on the claim and settle functions are preserved by CREATE OR REPLACE.

3. Notes
- "Not found" during reconciliation is never treated as a rejection; the item keeps confirming until Gmail confirms it or an operator intervenes.
- Idempotent: safe to re-apply.
*/

CREATE OR REPLACE FUNCTION public.outbox_actor_allowed(p_staff uuid, p_conversation uuid, p_created_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_ok boolean;
BEGIN
  SELECT (s.is_enabled AND p.owner_id = p_staff
    AND (s.sessions_revoked_at IS NULL OR s.sessions_revoked_at <= p_created_at))
  INTO v_ok
  FROM public.conversations c
  JOIN public.prospects p ON p.id = c.prospect_id
  JOIN public.staff_profiles s ON s.id = p_staff
  WHERE c.id = p_conversation;
  RETURN COALESCE(v_ok, false);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.outbox_actor_allowed(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gmail_outbox_claim(p_lease_seconds integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v public.gmail_outbox%ROWTYPE;
  v_ok boolean;
  v_action text;
  v_token uuid := gen_random_uuid();
  v_lease interval := make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 120), 600)));
BEGIN
  UPDATE public.gmail_outbox
  SET status = 'confirming',
      claim_token = NULL,
      lease_until = now() + interval '60 seconds',
      last_error = 'Envío interrumpido. Se confirmará en Gmail antes de reintentar.',
      updated_at = now()
  WHERE status = 'sending' AND lease_until < now();

  SELECT * INTO v FROM public.gmail_outbox o
  WHERE o.status = 'queued' OR (o.status = 'confirming' AND o.lease_until <= now())
  ORDER BY CASE WHEN o.status = 'confirming' THEN 0 ELSE 1 END, o.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_ok := public.outbox_actor_allowed(v.staff_id, v.conversation_id, v.created_at);

  IF v.status = 'queued' THEN
    IF NOT v_ok THEN
      UPDATE public.gmail_outbox
      SET status = 'failed', last_error = 'No tienes permiso para enviar este mensaje.', updated_at = now()
      WHERE id = v.id;
      RETURN jsonb_build_object('action', 'blocked', 'id', v.id);
    END IF;
    UPDATE public.gmail_outbox
    SET status = 'sending', claim_token = v_token, lease_until = now() + v_lease,
        attempts = attempts + 1, updated_at = now()
    WHERE id = v.id;
    v_action := 'send';
  ELSE
    IF NOT v_ok THEN
      UPDATE public.gmail_outbox
      SET lease_until = now() + interval '60 seconds',
          last_error = 'Pendiente de revisión: no se puede confirmar el envío con los permisos actuales.',
          updated_at = now()
      WHERE id = v.id;
      RETURN jsonb_build_object('action', 'blocked', 'id', v.id);
    END IF;
    UPDATE public.gmail_outbox
    SET claim_token = v_token, lease_until = now() + v_lease, updated_at = now()
    WHERE id = v.id;
    v_action := 'reconcile';
  END IF;

  RETURN jsonb_build_object(
    'action', v_action,
    'id', v.id,
    'claimToken', v_token,
    'requestId', v.request_id,
    'conversationId', v.conversation_id,
    'mailbox', v.mailbox_address,
    'customerKey', v.customer_key,
    'recipient', v.recipient,
    'subject', v.subject,
    'body', v.body,
    'draftRevision', v.draft_revision,
    'rfcMessageId', v.rfc_message_id,
    'threadId', v.thread_id,
    'inReplyTo', v.in_reply_to,
    'references', v.references_header,
    'sourceGmailMessageId', v.source_gmail_message_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.gmail_outbox_settle(p_id uuid, p_token uuid, p_outcome text, p_gmail_message_id text, p_gmail_thread_id text, p_error text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v public.gmail_outbox%ROWTYPE;
  v_prospect_id uuid;
  v_error text := left(COALESCE(p_error, ''), 300);
BEGIN
  SELECT * INTO v FROM public.gmail_outbox o WHERE o.id = p_id FOR UPDATE;
  IF NOT FOUND OR v.claim_token IS NULL OR v.claim_token IS DISTINCT FROM p_token THEN
    RETURN false;
  END IF;

  IF p_outcome NOT IN ('sent', 'failed', 'retry', 'uncertain') THEN
    RAISE EXCEPTION 'Resultado de envío no válido.';
  END IF;

  IF v.status = 'confirming' AND p_outcome <> 'sent' THEN
    UPDATE public.gmail_outbox
    SET status = 'confirming', claim_token = NULL,
        lease_until = now() + interval '60 seconds', last_error = v_error, updated_at = now()
    WHERE id = v.id;
    RETURN true;
  END IF;

  IF p_outcome = 'sent' THEN
    IF NULLIF(p_gmail_message_id, '') IS NULL THEN
      RAISE EXCEPTION 'Gmail no devolvió el identificador del mensaje.';
    END IF;
    UPDATE public.gmail_outbox
    SET status = 'sent', gmail_message_id = p_gmail_message_id,
        gmail_thread_id = NULLIF(p_gmail_thread_id, ''), sent_at = now(),
        claim_token = NULL, lease_until = NULL, last_error = '', updated_at = now()
    WHERE id = v.id;

    SELECT c.prospect_id INTO v_prospect_id FROM public.conversations c WHERE c.id = v.conversation_id;
    UPDATE public.conversations
    SET status = 'waiting_customer', unread = false, last_message_at = now()
    WHERE id = v.conversation_id;
    DELETE FROM public.drafts WHERE conversation_id = v.conversation_id AND revision = v.draft_revision;

    IF NULLIF(p_gmail_thread_id, '') IS NOT NULL THEN
      INSERT INTO public.gmail_threads (mailbox_address, gmail_thread_id, customer_key, prospect_id, conversation_id)
      VALUES (v.mailbox_address, p_gmail_thread_id, v.customer_key, v_prospect_id, v.conversation_id)
      ON CONFLICT DO NOTHING;
    END IF;

    INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
    VALUES (v.staff_id, v_prospect_id, 'message', 'Respuesta enviada por correo');
  ELSIF p_outcome = 'failed' THEN
    UPDATE public.gmail_outbox
    SET status = 'failed', claim_token = NULL, lease_until = NULL, last_error = v_error, updated_at = now()
    WHERE id = v.id;
  ELSIF p_outcome = 'retry' THEN
    UPDATE public.gmail_outbox
    SET status = CASE WHEN v.attempts >= 5 THEN 'failed' ELSE 'queued' END,
        claim_token = NULL, lease_until = NULL, last_error = v_error, updated_at = now()
    WHERE id = v.id;
  ELSE
    UPDATE public.gmail_outbox
    SET status = 'confirming', claim_token = NULL,
        lease_until = now() + interval '60 seconds', last_error = v_error, updated_at = now()
    WHERE id = v.id;
  END IF;
  RETURN true;
END;
$function$;
