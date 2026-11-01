/*
# Durable outbox for Gmail replies, draft revisions, and retired direct send

1. Summary
- Agent replies are now queued in a durable outbox, not inserted as sent. A Gmail message is only marked sent after Gmail accepts it.
- Each reply has a stable request ID (double-clicks and refreshes reuse it) and a stable RFC Message-ID (used to reconcile after an uncertain send).
- The recipient and thread are resolved on the server from the authorized conversation and shown before sending.
- Drafts gain a revision counter and a client save sequence, so older autosaves cannot overwrite newer text and a send clears only the revision it captured.

2. New table
- `gmail_outbox`: one row per reply. Holds the request ID, message link, staff owner, mailbox, customer key, recipient, subject, body snapshot, draft revision, RFC Message-ID, threading headers, status (queued, sending, confirming, sent, failed), attempts, claim token and lease, Gmail message and thread IDs, and the last error.
- Security: RLS on. The agent can read only their own rows (SELECT). All writes happen inside SECURITY DEFINER functions. No direct insert, update, or delete grants.

3. Modified tables
- `drafts`: `revision` (increments when the text changes) and `client_seq` (the newest accepted autosave sequence).

4. Functions
- Public (signed-in agents): `save_draft(uuid, text, bigint)` replaces the old two-argument version; `request_reply_send(uuid, uuid)`; `get_reply_target(uuid)`.
- Internal (no public grant): `draft_save_as`, `reply_send_as`, `reply_target_for`, `reply_address_ok`.
- Worker (service role only): `gmail_outbox_claim`, `gmail_outbox_set_headers`, `gmail_outbox_settle`.
- Retired: `send_reply` is dropped. It inserted a local message and never sent email.

5. Important notes
- A send is refused while another reply in the same conversation is queued, sending, or confirming.
- Failed sends keep the draft. Uncertain sends stay "Confirmando envío" and are reconciled by Message-ID; they are never sent again automatically.
- The worker rechecks that the staff member is enabled, still owns the conversation, and was not revoked after the request was made.
- Idempotent: all DDL uses IF NOT EXISTS, and functions use CREATE OR REPLACE.
*/

ALTER TABLE public.drafts ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE public.drafts ADD COLUMN IF NOT EXISTS client_seq bigint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drafts_revision_check') THEN
    ALTER TABLE public.drafts ADD CONSTRAINT drafts_revision_check CHECK (revision >= 1 AND client_seq >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.gmail_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL UNIQUE REFERENCES public.messages(id) ON DELETE CASCADE,
  staff_id text NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  mailbox_address text NOT NULL CHECK (char_length(mailbox_address) BETWEEN 3 AND 254),
  customer_key text NOT NULL CHECK (char_length(customer_key) <= 254),
  recipient text NOT NULL CHECK (char_length(recipient) BETWEEN 3 AND 254),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 320),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  draft_revision integer NOT NULL CHECK (draft_revision >= 1),
  rfc_message_id text NOT NULL UNIQUE CHECK (char_length(rfc_message_id) BETWEEN 3 AND 255),
  source_gmail_message_id text CHECK (source_gmail_message_id IS NULL OR char_length(source_gmail_message_id) <= 64),
  thread_id text CHECK (thread_id IS NULL OR char_length(thread_id) <= 64),
  in_reply_to text CHECK (in_reply_to IS NULL OR char_length(in_reply_to) <= 255),
  references_header text NOT NULL DEFAULT '' CHECK (char_length(references_header) <= 4000),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'confirming', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claim_token uuid,
  lease_until timestamptz,
  gmail_message_id text CHECK (gmail_message_id IS NULL OR char_length(gmail_message_id) <= 64),
  gmail_thread_id text CHECK (gmail_thread_id IS NULL OR char_length(gmail_thread_id) <= 64),
  last_error text NOT NULL DEFAULT '' CHECK (char_length(last_error) <= 300),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmail_outbox_sent_check CHECK (status <> 'sent' OR (gmail_message_id IS NOT NULL AND sent_at IS NOT NULL)),
  CONSTRAINT gmail_outbox_lease_check CHECK (status NOT IN ('sending', 'confirming') OR lease_until IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS gmail_outbox_gmail_message_idx
  ON public.gmail_outbox (mailbox_address, gmail_message_id) WHERE gmail_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS gmail_outbox_queue_idx ON public.gmail_outbox (status, created_at);
CREATE INDEX IF NOT EXISTS gmail_outbox_conversation_idx ON public.gmail_outbox (conversation_id, created_at);

ALTER TABLE public.gmail_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.gmail_outbox FROM PUBLIC, anon;
GRANT SELECT ON public.gmail_outbox TO authenticated;

DROP POLICY IF EXISTS "select_own_gmail_outbox" ON public.gmail_outbox;
CREATE POLICY "select_own_gmail_outbox" ON public.gmail_outbox FOR SELECT
TO authenticated USING (staff_id = public.current_staff_id());

DROP FUNCTION IF EXISTS public.send_reply(uuid, text);
DROP FUNCTION IF EXISTS public.save_draft(uuid, text);

CREATE OR REPLACE FUNCTION public.reply_address_ok(p_address text, p_mailbox text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $f$
SELECT p_address IS NOT NULL
AND char_length(p_address) BETWEEN 3 AND 254
AND p_address ~* '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$'
AND lower(p_address) <> lower(COALESCE(p_mailbox, ''))
AND NOT EXISTS (
SELECT 1 FROM public.gmail_lead_notification_senders n WHERE n.address = lower(p_address)
)
$f$;

CREATE OR REPLACE FUNCTION public.reply_target_for(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
v_mailbox text;
v_keys text[];
v_key text;
v_last public.gmail_messages%ROWTYPE;
v_reply public.gmail_messages%ROWTYPE;
v_has_reply boolean := false;
v_out public.gmail_outbox%ROWTYPE;
v_has_out boolean := false;
v_recipient text;
v_subject text;
v_thread text := NULL;
v_parent text := NULL;
v_parent_refs text := '';
v_source text := NULL;
v_refs text;
BEGIN
SELECT s.mailbox_address INTO v_mailbox FROM public.gmail_sync_state s WHERE s.id = 1;
SELECT COALESCE(array_agg(DISTINCT t.customer_key), '{}') INTO v_keys
FROM public.gmail_threads t
WHERE t.conversation_id = p_conversation_id AND t.mailbox_address = v_mailbox;

IF cardinality(v_keys) = 0 THEN
RETURN jsonb_build_object('ok', false, 'reason', 'sin_correo');
END IF;
IF cardinality(v_keys) <> 1 OR v_keys[1] = '' THEN
RETURN jsonb_build_object('ok', false, 'reason', 'destinatario_no_confirmado');
END IF;
v_key := v_keys[1];

SELECT * INTO v_last FROM public.gmail_messages m
WHERE m.conversation_id = p_conversation_id
ORDER BY m.sent_at DESC LIMIT 1;
IF NOT FOUND THEN
RETURN jsonb_build_object('ok', false, 'reason', 'sin_correo');
END IF;

IF v_last.via_notification THEN
v_recipient := v_key;
ELSIF lower(v_last.from_address) <> v_key THEN
RETURN jsonb_build_object('ok', false, 'reason', 'destinatario_no_confirmado');
ELSE
v_recipient := v_last.from_address;
IF public.reply_address_ok(v_last.reply_to, v_mailbox) THEN
v_recipient := v_last.reply_to;
END IF;
END IF;

IF NOT public.reply_address_ok(v_recipient, v_mailbox) THEN
RETURN jsonb_build_object('ok', false, 'reason', 'destinatario_no_confirmado');
END IF;

SELECT * INTO v_reply FROM public.gmail_messages m
WHERE m.conversation_id = p_conversation_id AND NOT m.via_notification
ORDER BY m.sent_at DESC LIMIT 1;
v_has_reply := FOUND;

SELECT * INTO v_out FROM public.gmail_outbox o
WHERE o.conversation_id = p_conversation_id AND o.status = 'sent'
ORDER BY o.sent_at DESC LIMIT 1;
v_has_out := FOUND;

IF v_has_out AND (NOT v_has_reply OR v_out.sent_at >= v_reply.sent_at) THEN
v_thread := v_out.gmail_thread_id;
v_parent := v_out.rfc_message_id;
v_parent_refs := v_out.references_header;
ELSIF v_has_reply THEN
v_thread := v_reply.gmail_thread_id;
v_parent := v_reply.rfc_message_id;
v_parent_refs := v_reply.references_header;
v_source := CASE WHEN v_reply.rfc_message_id IS NULL THEN v_reply.gmail_message_id ELSE NULL END;
END IF;

v_refs := CASE
WHEN v_parent IS NULL THEN ''
WHEN btrim(v_parent_refs) = '' THEN v_parent
ELSE left(btrim(v_parent_refs) || ' ' || v_parent, 4000)
END;

SELECT COALESCE(NULLIF(btrim(c.subject), ''), '(sin asunto)') INTO v_subject
FROM public.conversations c WHERE c.id = p_conversation_id;
IF v_subject !~* '^re:' THEN
v_subject := 'Re: ' || v_subject;
END IF;

RETURN jsonb_build_object(
'ok', true,
'mailbox', v_mailbox,
'customerKey', v_key,
'recipient', v_recipient,
'subject', left(v_subject, 300),
'threadId', v_thread,
'inReplyTo', v_parent,
'references', v_refs,
'sourceGmailMessageId', v_source
);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_reply_target(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
v_me text := public.current_staff_id();
v_owner text;
BEGIN
SELECT p.owner_id INTO v_owner
FROM public.conversations c JOIN public.prospects p ON p.id = c.prospect_id
WHERE c.id = p_conversation_id;
IF v_me IS NULL OR v_owner IS DISTINCT FROM v_me THEN
RAISE EXCEPTION 'Solo el agente asignado puede responder esta conversación.' USING ERRCODE = '42501';
END IF;
RETURN public.reply_target_for(p_conversation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.draft_save_as(p_staff_id text, p_conversation_id uuid, p_body text, p_client_seq bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
v_owner text;
v_body text := COALESCE(p_body, '');
v_draft public.drafts%ROWTYPE;
v_applied boolean := true;
v_now timestamptz := now();
BEGIN
SELECT p.owner_id INTO v_owner
FROM public.conversations c JOIN public.prospects p ON p.id = c.prospect_id
WHERE c.id = p_conversation_id;
IF p_staff_id IS NULL OR v_owner IS DISTINCT FROM p_staff_id THEN
RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
END IF;
IF char_length(v_body) > 4000 THEN
RAISE EXCEPTION 'El borrador es demasiado largo.';
END IF;
IF p_client_seq IS NULL OR p_client_seq < 0 THEN
RAISE EXCEPTION 'Borrador no válido.';
END IF;

SELECT * INTO v_draft FROM public.drafts d WHERE d.conversation_id = p_conversation_id FOR UPDATE;
IF NOT FOUND THEN
INSERT INTO public.drafts (conversation_id, staff_id, body, updated_at, revision, client_seq)
VALUES (
p_conversation_id, p_staff_id, v_body, v_now,
1 + COALESCE((SELECT max(o.draft_revision) FROM public.gmail_outbox o WHERE o.conversation_id = p_conversation_id), 0),
p_client_seq
)
RETURNING * INTO v_draft;
ELSIF p_client_seq < v_draft.client_seq THEN
v_applied := false;
ELSIF v_body = v_draft.body THEN
UPDATE public.drafts SET client_seq = p_client_seq, staff_id = p_staff_id
WHERE conversation_id = p_conversation_id
RETURNING * INTO v_draft;
ELSE
UPDATE public.drafts
SET body = v_body,
revision = v_draft.revision + 1,
client_seq = p_client_seq,
staff_id = p_staff_id,
updated_at = v_now
WHERE conversation_id = p_conversation_id
RETURNING * INTO v_draft;
END IF;

RETURN jsonb_build_object(
'applied', v_applied,
'revision', v_draft.revision,
'body', v_draft.body,
'updatedAt', v_draft.updated_at
);
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_draft(p_conversation_id uuid, p_body text, p_client_seq bigint)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT public.draft_save_as(public.current_staff_id(), p_conversation_id, p_body, p_client_seq)
$function$;

CREATE OR REPLACE FUNCTION public.reply_send_as(p_staff_id text, p_conversation_id uuid, p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
v_owner text;
v_existing public.gmail_outbox%ROWTYPE;
v_status text;
v_draft public.drafts%ROWTYPE;
v_target jsonb;
v_message_id uuid;
v_outbox_id uuid;
v_body text;
BEGIN
PERFORM pg_advisory_xact_lock(hashtext('reply-send:' || p_conversation_id::text));

SELECT p.owner_id INTO v_owner
FROM public.conversations c JOIN public.prospects p ON p.id = c.prospect_id
WHERE c.id = p_conversation_id;
IF p_staff_id IS NULL OR v_owner IS DISTINCT FROM p_staff_id THEN
RAISE EXCEPTION 'Solo el agente asignado puede responder esta conversación.' USING ERRCODE = '42501';
END IF;
IF p_request_id IS NULL THEN
RAISE EXCEPTION 'Solicitud de envío no válida.';
END IF;

SELECT * INTO v_existing FROM public.gmail_outbox o WHERE o.request_id = p_request_id FOR UPDATE;
IF FOUND THEN
IF v_existing.staff_id <> p_staff_id OR v_existing.conversation_id <> p_conversation_id THEN
RAISE EXCEPTION 'Solicitud de envío no válida.' USING ERRCODE = '42501';
END IF;
v_status := v_existing.status;
IF v_status = 'failed' THEN
UPDATE public.gmail_outbox SET status = 'queued', last_error = '', updated_at = now()
WHERE id = v_existing.id;
v_status := 'queued';
END IF;
RETURN jsonb_build_object('outboxId', v_existing.id, 'messageId', v_existing.message_id, 'status', v_status, 'created', false);
END IF;

IF EXISTS (
SELECT 1 FROM public.gmail_outbox o
WHERE o.conversation_id = p_conversation_id AND o.status IN ('queued', 'sending', 'confirming')
) THEN
RAISE EXCEPTION 'Hay un envío pendiente en esta conversación. Espera a que termine antes de enviar otra respuesta.';
END IF;

SELECT * INTO v_draft FROM public.drafts d WHERE d.conversation_id = p_conversation_id FOR UPDATE;
v_body := btrim(COALESCE(v_draft.body, ''));
IF NOT FOUND OR v_body = '' THEN
RAISE EXCEPTION 'Escribe una respuesta antes de enviar.';
END IF;
IF char_length(v_body) > 8000 THEN
RAISE EXCEPTION 'La respuesta debe tener entre 1 y 8000 caracteres.';
END IF;

v_target := public.reply_target_for(p_conversation_id);
IF NOT COALESCE((v_target->>'ok')::boolean, false) THEN
IF v_target->>'reason' = 'sin_correo' THEN
RAISE EXCEPTION 'Esta conversación no tiene un correo del cliente al que responder.';
END IF;
RAISE EXCEPTION 'No podemos confirmar con seguridad a qué correo enviar esta respuesta. Revisa el destinatario antes de enviar.';
END IF;

INSERT INTO public.messages (conversation_id, author, body, sent_by, sent_at)
VALUES (p_conversation_id, 'agent', v_body, p_staff_id, now())
RETURNING id INTO v_message_id;

INSERT INTO public.gmail_outbox (
request_id, conversation_id, message_id, staff_id, mailbox_address, customer_key,
recipient, subject, body, draft_revision, rfc_message_id, source_gmail_message_id,
thread_id, in_reply_to, references_header
)
VALUES (
p_request_id, p_conversation_id, v_message_id, p_staff_id,
v_target->>'mailbox', v_target->>'customerKey',
v_target->>'recipient', v_target->>'subject', v_body, v_draft.revision,
'<' || gen_random_uuid()::text || '@' || split_part(v_target->>'mailbox', '@', 2) || '>',
v_target->>'sourceGmailMessageId', v_target->>'threadId',
v_target->>'inReplyTo', COALESCE(v_target->>'references', '')
)
RETURNING id INTO v_outbox_id;

RETURN jsonb_build_object('outboxId', v_outbox_id, 'messageId', v_message_id, 'status', 'queued', 'created', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_reply_send(p_conversation_id uuid, p_request_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT public.reply_send_as(public.current_staff_id(), p_conversation_id, p_request_id)
$function$;

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

IF v.status = 'queued' THEN
SELECT (s.is_enabled AND p.owner_id = v.staff_id
AND (s.sessions_revoked_at IS NULL OR s.sessions_revoked_at <= v.created_at))
INTO v_ok
FROM public.conversations c
JOIN public.prospects p ON p.id = c.prospect_id
JOIN public.staff_profiles s ON s.id = v.staff_id
WHERE c.id = v.conversation_id;
IF NOT COALESCE(v_ok, false) THEN
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

CREATE OR REPLACE FUNCTION public.gmail_outbox_set_headers(p_id uuid, p_token uuid, p_rfc_message_id text, p_source_references text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
v public.gmail_outbox%ROWTYPE;
BEGIN
SELECT * INTO v FROM public.gmail_outbox o WHERE o.id = p_id FOR UPDATE;
IF NOT FOUND OR v.claim_token IS NULL OR v.claim_token IS DISTINCT FROM p_token THEN
RETURN false;
END IF;
IF p_rfc_message_id IS NULL OR char_length(p_rfc_message_id) NOT BETWEEN 3 AND 255 THEN
RAISE EXCEPTION 'Encabezado de mensaje no válido.';
END IF;

UPDATE public.gmail_outbox
SET in_reply_to = p_rfc_message_id,
references_header = CASE
WHEN btrim(COALESCE(p_source_references, '')) = '' THEN p_rfc_message_id
ELSE left(btrim(p_source_references) || ' ' || p_rfc_message_id, 4000)
END,
updated_at = now()
WHERE id = p_id;

IF v.source_gmail_message_id IS NOT NULL THEN
UPDATE public.gmail_messages
SET rfc_message_id = p_rfc_message_id,
references_header = left(COALESCE(p_source_references, ''), 4000)
WHERE mailbox_address = v.mailbox_address
AND gmail_message_id = v.source_gmail_message_id
AND rfc_message_id IS NULL;
END IF;
RETURN true;
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
ELSIF p_outcome = 'uncertain' THEN
UPDATE public.gmail_outbox
SET status = 'confirming', claim_token = NULL,
lease_until = now() + interval '60 seconds', last_error = v_error, updated_at = now()
WHERE id = v.id;
ELSE
RAISE EXCEPTION 'Resultado de envío no válido.';
END IF;
RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reply_address_ok(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reply_target_for(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.draft_save_as(text, uuid, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reply_send_as(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gmail_outbox_claim(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gmail_outbox_set_headers(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gmail_outbox_settle(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_reply_target(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_reply_send(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_draft(uuid, text, bigint) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_reply_target(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_reply_send(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_draft(uuid, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gmail_outbox_claim(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.gmail_outbox_set_headers(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gmail_outbox_settle(uuid, uuid, text, text, text, text) TO service_role;
