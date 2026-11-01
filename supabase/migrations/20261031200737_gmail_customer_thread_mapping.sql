/*
# Map Gmail threads per customer and keep reply headers on inbound mail

1. Summary
- Gmail threads were mapped only by mailbox and Gmail thread ID. Two form customers whose notifications share one thread were merged into one conversation.
- Each mapping now also records the customer key (the customer's email). A conversation belongs to one customer key per mailbox.
- Inbound messages keep their RFC Message-ID and References header, so replies can thread correctly. Older imports keep these empty and are fetched from Gmail when needed.
- Inbound messages record whether they came through a trusted website or form notification.

2. Modified tables
- `gmail_threads`: new `customer_key` column (backfilled from the prospect email). The primary key becomes (mailbox, thread, customer key). The one-thread-per-conversation constraint is removed because a form customer can own an outbound thread next to the notification thread.
- `gmail_messages`: new `rfc_message_id`, `references_header`, and `via_notification` columns.

3. Functions
- `gmail_record_message` now finds the conversation by thread AND customer key, then by customer key alone, so one customer always lands in one conversation. It stores the new header fields.

4. Security
- No new tables and no grant changes. Existing RLS stays on.

5. Notes
- Idempotent: each step checks for existing objects, so a re-run is safe.
- Existing rows without a customer key get the prospect email; rows whose prospect has no email keep an empty key and are blocked from sending until the owner reviews them.
*/

ALTER TABLE public.gmail_messages ADD COLUMN IF NOT EXISTS rfc_message_id text;
ALTER TABLE public.gmail_messages ADD COLUMN IF NOT EXISTS references_header text NOT NULL DEFAULT '';
ALTER TABLE public.gmail_messages ADD COLUMN IF NOT EXISTS via_notification boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gmail_messages_rfc_message_id_check') THEN
    ALTER TABLE public.gmail_messages ADD CONSTRAINT gmail_messages_rfc_message_id_check
      CHECK (rfc_message_id IS NULL OR char_length(rfc_message_id) BETWEEN 3 AND 255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gmail_messages_references_check') THEN
    ALTER TABLE public.gmail_messages ADD CONSTRAINT gmail_messages_references_check
      CHECK (char_length(references_header) <= 4000);
  END IF;
END $$;

ALTER TABLE public.gmail_threads ADD COLUMN IF NOT EXISTS customer_key text;

UPDATE public.gmail_threads t
SET customer_key = lower(btrim(p.email))
FROM public.prospects p
WHERE p.id = t.prospect_id
AND t.customer_key IS NULL;

UPDATE public.gmail_threads SET customer_key = '' WHERE customer_key IS NULL;

ALTER TABLE public.gmail_threads ALTER COLUMN customer_key SET DEFAULT '';
ALTER TABLE public.gmail_threads ALTER COLUMN customer_key SET NOT NULL;

ALTER TABLE public.gmail_threads DROP CONSTRAINT IF EXISTS gmail_threads_conversation_id_key;
ALTER TABLE public.gmail_threads DROP CONSTRAINT IF EXISTS gmail_threads_pkey;
ALTER TABLE public.gmail_threads ADD CONSTRAINT gmail_threads_pkey
  PRIMARY KEY (mailbox_address, gmail_thread_id, customer_key);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gmail_threads_customer_key_check') THEN
    ALTER TABLE public.gmail_threads ADD CONSTRAINT gmail_threads_customer_key_check
      CHECK (char_length(customer_key) <= 254 AND customer_key = lower(customer_key));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS gmail_threads_conversation_idx ON public.gmail_threads (conversation_id);
CREATE INDEX IF NOT EXISTS gmail_threads_customer_idx ON public.gmail_threads (mailbox_address, customer_key);

CREATE OR REPLACE FUNCTION public.gmail_record_message(p_version integer, p_token uuid, p_message jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
v_mailbox text;
v_message_id text := btrim(COALESCE(p_message->>'gmailMessageId', ''));
v_thread_id text := btrim(COALESCE(p_message->>'gmailThreadId', ''));
v_from_address text := left(btrim(COALESCE(p_message->>'fromAddress', '')), 254);
v_from_name text := left(btrim(COALESCE(p_message->>'fromName', '')), 160);
v_reply_to text := left(btrim(COALESCE(p_message->>'replyTo', '')), 254);
v_subject text := left(btrim(COALESCE(p_message->>'subject', '')), 300);
v_contact_email text := left(btrim(COALESCE(p_message->>'contactEmail', '')), 254);
v_contact_name text := left(btrim(COALESCE(p_message->>'contactName', '')), 160);
v_contact_phone text := left(btrim(COALESCE(p_message->>'contactPhone', '')), 40);
v_customer_key text;
v_rfc_message_id text := NULLIF(left(btrim(COALESCE(p_message->>'rfcMessageId', '')), 255), '');
v_references text := left(btrim(COALESCE(p_message->>'references', '')), 4000);
v_via_notification boolean := COALESCE((p_message->>'viaNotification')::boolean, false);
v_body text := p_message->>'body';
v_sent_at timestamptz := (p_message->>'sentAt')::timestamptz;
v_prospect_id uuid;
v_conversation_id uuid;
v_outcome text := 'reply';
BEGIN
SELECT s.mailbox_address INTO v_mailbox FROM public.gmail_sync_state s WHERE s.id = 1;
IF NOT public.gmail_sync_guard(p_version, p_token) THEN
RETURN jsonb_build_object('outcome', 'stale');
END IF;
IF v_message_id = '' OR v_thread_id = '' OR v_body IS NULL OR v_sent_at IS NULL THEN
RAISE EXCEPTION 'Mensaje de Gmail incompleto.';
END IF;
v_customer_key := lower(COALESCE(NULLIF(v_contact_email, ''), v_from_address));
IF v_customer_key = '' THEN
RAISE EXCEPTION 'Mensaje de Gmail sin remitente.';
END IF;

PERFORM pg_advisory_xact_lock(hashtext('gmail-message:' || v_mailbox || ':' || v_message_id));
IF EXISTS (
SELECT 1 FROM public.gmail_messages m
WHERE m.mailbox_address = v_mailbox AND m.gmail_message_id = v_message_id
) THEN
SELECT m.conversation_id INTO v_conversation_id FROM public.gmail_messages m
WHERE m.mailbox_address = v_mailbox AND m.gmail_message_id = v_message_id;
SELECT c.prospect_id INTO v_prospect_id FROM public.conversations c WHERE c.id = v_conversation_id;
RETURN jsonb_build_object('outcome', 'duplicate', 'conversationId', v_conversation_id, 'prospectId', v_prospect_id);
END IF;

PERFORM pg_advisory_xact_lock(hashtext('gmail-customer:' || v_mailbox || ':' || v_customer_key));
SELECT t.conversation_id, t.prospect_id INTO v_conversation_id, v_prospect_id
FROM public.gmail_threads t
WHERE t.mailbox_address = v_mailbox
AND t.gmail_thread_id = v_thread_id
AND t.customer_key = v_customer_key;

IF v_conversation_id IS NULL THEN
SELECT t.conversation_id, t.prospect_id INTO v_conversation_id, v_prospect_id
FROM public.gmail_threads t
WHERE t.mailbox_address = v_mailbox
AND t.customer_key = v_customer_key
ORDER BY t.conversation_id
LIMIT 1;
END IF;

IF v_conversation_id IS NULL THEN
v_outcome := 'created';
v_prospect_id := public.intake_inquiry(
COALESCE(NULLIF(v_contact_name, ''), NULLIF(v_contact_email, ''), NULLIF(v_contact_phone, ''), 'Consulta por correo'),
v_contact_name,
v_contact_email,
v_contact_phone,
'',
'',
'email',
NULL,
false,
'gmail-customer:' || v_mailbox || ':' || v_customer_key,
NULL
);

SELECT c.id INTO v_conversation_id FROM public.conversations c WHERE c.prospect_id = v_prospect_id;
UPDATE public.conversations
SET subject = COALESCE(NULLIF(v_subject, ''), '(sin asunto)')
WHERE id = v_conversation_id;
END IF;

INSERT INTO public.gmail_threads (mailbox_address, gmail_thread_id, customer_key, prospect_id, conversation_id)
VALUES (v_mailbox, v_thread_id, v_customer_key, v_prospect_id, v_conversation_id)
ON CONFLICT DO NOTHING;

INSERT INTO public.messages (conversation_id, author, body, sent_at)
VALUES (v_conversation_id, 'customer', v_body, v_sent_at);

INSERT INTO public.gmail_messages (
mailbox_address, gmail_message_id, gmail_thread_id, conversation_id,
from_address, from_name, reply_to, subject, sent_at,
rfc_message_id, references_header, via_notification
)
VALUES (
v_mailbox, v_message_id, v_thread_id, v_conversation_id,
v_from_address, v_from_name, v_reply_to, v_subject, v_sent_at,
v_rfc_message_id, v_references, v_via_notification
);

UPDATE public.conversations
SET unread = true,
status = 'waiting_agent',
last_message_at = GREATEST(last_message_at, v_sent_at)
WHERE id = v_conversation_id;

UPDATE public.prospects
SET email = CASE WHEN email = '' THEN v_contact_email ELSE email END,
contact_name = CASE WHEN contact_name = '' THEN v_contact_name ELSE contact_name END,
phone = CASE WHEN phone = '' THEN v_contact_phone ELSE phone END,
updated_at = now()
WHERE id = v_prospect_id;

RETURN jsonb_build_object('outcome', v_outcome, 'conversationId', v_conversation_id, 'prospectId', v_prospect_id);
END;
$function$;
