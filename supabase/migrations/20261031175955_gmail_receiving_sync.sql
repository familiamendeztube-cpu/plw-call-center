/*
# Gmail receiving: background sync, threads, and atomic inbound intake

1. Plain-English summary
- A server scheduler (pg_cron) wakes the Gmail sync function every minute. The function does nothing unless an administrator has started synchronization and Google is connected, so it keeps working with nobody logged in.
- Each new customer email creates one customer, one conversation, and one queue entry in the same database transaction. Replies on the same Gmail thread join the existing conversation and keep its owner.
- Each Gmail message is stored once per mailbox. Repeated or simultaneous imports return the existing result.
- Administrators can start or pause synchronization and choose the initial import date. Pausing, changing the date, or disconnecting Google stops in-flight work immediately.

2. New tables
- gmail_sync_state (one row): running flag, initial import date, phase (listing or incremental), page token, Gmail history cursor, lease expiry, last success, last error, and failure count.
- gmail_threads: maps a Gmail thread to its conversation and prospect.
- gmail_messages: one row per imported Gmail message, unique per mailbox and Gmail message ID. Stores sender, Reply-To, subject, and date.

3. Functions
- gmail_sync_claim (service role): leases one run when running, connected, and not already leased.
- gmail_sync_checkpoint (service role): saves progress, errors, and success, only while the lease and connection version still match.
- gmail_record_message (service role): imports one message atomically and returns created, reply, duplicate, or stale.
- gmail_sync_scheduler_matches (service role): checks the scheduler token held in the vault.
- gmail_sync_tick: called by the scheduler; sends a request to the sync function when running.
- admin_gmail_sync_status and admin_set_gmail_sync (administrators only).

4. Security
- Row level security is enabled on every new table and all client roles are revoked. Administrators reach the state only through the admin functions.
- The scheduler token is generated in the vault and never returned to browsers.
- Writes from the sync function require a live lease and an unchanged Google connection version.

5. Important notes
- Message content is stored as plain text and must be rendered as text, never as HTML.
- Sent mail, drafts, spam, trash, and bounces are filtered by the sync function before import.
- Existing assignment rules (round robin, waiting queue, capacity, and availability) are reused through the shared intake function.
*/

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

CREATE TABLE IF NOT EXISTS public.gmail_sync_state (
  id integer PRIMARY KEY CHECK (id = 1),
  mailbox_address text NOT NULL DEFAULT 'plw@professionallatinoworker2026.com',
  is_running boolean NOT NULL DEFAULT false,
  import_from timestamptz,
  phase text NOT NULL DEFAULT 'idle' CHECK (phase IN ('idle', 'listing', 'incremental')),
  page_token text,
  history_id text,
  lease_until timestamptz,
  last_success_at timestamptz,
  last_error text CHECK (char_length(last_error) <= 300),
  last_error_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.gmail_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.gmail_threads (
  mailbox_address text NOT NULL,
  gmail_thread_id text NOT NULL CHECK (char_length(gmail_thread_id) BETWEEN 1 AND 64),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL UNIQUE REFERENCES public.conversations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mailbox_address, gmail_thread_id)
);

CREATE TABLE IF NOT EXISTS public.gmail_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mailbox_address text NOT NULL,
  gmail_message_id text NOT NULL CHECK (char_length(gmail_message_id) BETWEEN 1 AND 64),
  gmail_thread_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  from_address text NOT NULL DEFAULT '' CHECK (char_length(from_address) <= 254),
  from_name text NOT NULL DEFAULT '' CHECK (char_length(from_name) <= 160),
  reply_to text NOT NULL DEFAULT '' CHECK (char_length(reply_to) <= 254),
  subject text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 300),
  sent_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mailbox_address, gmail_message_id)
);
CREATE INDEX IF NOT EXISTS gmail_messages_thread_idx ON public.gmail_messages (mailbox_address, gmail_thread_id);

ALTER TABLE public.gmail_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gmail_sync_state, public.gmail_threads, public.gmail_messages FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'gmail_sync_scheduler_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'gmail_sync_scheduler_secret',
      'Shared token between the scheduler and the Gmail sync function'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.gmail_sync_scheduler_matches(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT s.decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets s
  WHERE s.name = 'gmail_sync_scheduler_secret';
  RETURN v_secret IS NOT NULL AND p_token IS NOT NULL AND p_token = v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.gmail_sync_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token text;
  v_request bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.gmail_sync_state s WHERE s.id = 1 AND s.is_running) THEN
    RETURN NULL;
  END IF;

  SELECT s.decrypted_secret INTO v_token
  FROM vault.decrypted_secrets s
  WHERE s.name = 'gmail_sync_scheduler_secret';

  SELECT net.http_post(
    url := 'https://piynmutwibhmitdcfvyf.supabase.co/functions/v1/gmail-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_request;

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.gmail_sync_guard(p_version integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.gmail_sync_state s
    JOIN public.google_workspace_connections c ON c.mailbox_address = s.mailbox_address
    WHERE s.id = 1
      AND s.is_running
      AND s.lease_until > now()
      AND c.status = 'connected'
      AND c.connection_version = p_version
  );
$$;

CREATE OR REPLACE FUNCTION public.gmail_sync_claim()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state public.gmail_sync_state%ROWTYPE;
  v_version integer;
  v_status text;
  v_phase text;
BEGIN
  SELECT * INTO v_state FROM public.gmail_sync_state WHERE id = 1 FOR UPDATE;
  IF NOT v_state.is_running THEN RETURN NULL; END IF;
  IF v_state.lease_until IS NOT NULL AND v_state.lease_until > now() THEN RETURN NULL; END IF;

  SELECT c.connection_version, c.status INTO v_version, v_status
  FROM public.google_workspace_connections c
  WHERE c.mailbox_address = v_state.mailbox_address;
  IF v_status IS DISTINCT FROM 'connected' THEN RETURN NULL; END IF;

  v_phase := CASE WHEN v_state.phase = 'idle' THEN 'listing' ELSE v_state.phase END;
  UPDATE public.gmail_sync_state
  SET lease_until = now() + interval '3 minutes', phase = v_phase, updated_at = now()
  WHERE id = 1;

  RETURN jsonb_build_object(
    'connectionVersion', v_version,
    'phase', v_phase,
    'pageToken', v_state.page_token,
    'historyId', v_state.history_id,
    'importFrom', v_state.import_from
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.gmail_sync_checkpoint(
  p_version integer,
  p_phase text,
  p_page_token text,
  p_history_id text,
  p_release boolean,
  p_error text,
  p_success boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.gmail_sync_guard(p_version) THEN RETURN false; END IF;

  UPDATE public.gmail_sync_state
  SET phase = p_phase,
      page_token = p_page_token,
      history_id = COALESCE(p_history_id, history_id),
      last_success_at = CASE WHEN p_success THEN now() ELSE last_success_at END,
      last_error = CASE
        WHEN p_success THEN NULL
        WHEN p_error IS NOT NULL THEN left(p_error, 300)
        ELSE last_error
      END,
      last_error_at = CASE WHEN p_error IS NOT NULL THEN now() ELSE last_error_at END,
      consecutive_failures = CASE
        WHEN p_success THEN 0
        WHEN p_error IS NOT NULL THEN consecutive_failures + 1
        ELSE consecutive_failures
      END,
      lease_until = CASE WHEN p_release THEN NULL ELSE lease_until END,
      updated_at = now()
  WHERE id = 1;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.gmail_record_message(p_version integer, p_message jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mailbox text;
  v_message_id text := btrim(COALESCE(p_message->>'gmailMessageId', ''));
  v_thread_id text := btrim(COALESCE(p_message->>'gmailThreadId', ''));
  v_from_address text := left(btrim(COALESCE(p_message->>'fromAddress', '')), 254);
  v_from_name text := left(btrim(COALESCE(p_message->>'fromName', '')), 160);
  v_reply_to text := left(btrim(COALESCE(p_message->>'replyTo', '')), 254);
  v_subject text := left(btrim(COALESCE(p_message->>'subject', '')), 300);
  v_body text := p_message->>'body';
  v_sent_at timestamptz := (p_message->>'sentAt')::timestamptz;
  v_prospect_id uuid;
  v_conversation_id uuid;
  v_outcome text := 'reply';
BEGIN
  SELECT s.mailbox_address INTO v_mailbox FROM public.gmail_sync_state s WHERE s.id = 1;
  IF NOT public.gmail_sync_guard(p_version) THEN
    RETURN jsonb_build_object('outcome', 'stale');
  END IF;
  IF v_message_id = '' OR v_thread_id = '' OR v_body IS NULL OR v_sent_at IS NULL THEN
    RAISE EXCEPTION 'Mensaje de Gmail incompleto.';
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

  PERFORM pg_advisory_xact_lock(hashtext('gmail-thread:' || v_mailbox || ':' || v_thread_id));
  SELECT t.conversation_id, t.prospect_id INTO v_conversation_id, v_prospect_id
  FROM public.gmail_threads t
  WHERE t.mailbox_address = v_mailbox AND t.gmail_thread_id = v_thread_id;

  IF v_conversation_id IS NULL THEN
    v_outcome := 'created';
    v_prospect_id := public.intake_inquiry(
      COALESCE(NULLIF(v_from_name, ''), NULLIF(v_from_address, ''), 'Consulta por correo'),
      v_from_name,
      v_from_address,
      '',
      '',
      '',
      'email',
      NULL,
      false,
      'gmail-thread:' || v_mailbox || ':' || v_thread_id,
      NULL
    );

    SELECT c.id INTO v_conversation_id FROM public.conversations c WHERE c.prospect_id = v_prospect_id;
    UPDATE public.conversations
    SET subject = COALESCE(NULLIF(v_subject, ''), '(sin asunto)')
    WHERE id = v_conversation_id;

    INSERT INTO public.gmail_threads (mailbox_address, gmail_thread_id, prospect_id, conversation_id)
    VALUES (v_mailbox, v_thread_id, v_prospect_id, v_conversation_id)
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.messages (conversation_id, author, body, sent_at)
  VALUES (v_conversation_id, 'customer', v_body, v_sent_at);

  INSERT INTO public.gmail_messages (
    mailbox_address, gmail_message_id, gmail_thread_id, conversation_id,
    from_address, from_name, reply_to, subject, sent_at
  )
  VALUES (
    v_mailbox, v_message_id, v_thread_id, v_conversation_id,
    v_from_address, v_from_name, v_reply_to, v_subject, v_sent_at
  );

  UPDATE public.conversations
  SET unread = true,
      status = 'waiting_agent',
      last_message_at = GREATEST(last_message_at, v_sent_at)
  WHERE id = v_conversation_id;

  UPDATE public.prospects
  SET email = CASE WHEN email = '' THEN v_from_address ELSE email END,
      contact_name = CASE WHEN contact_name = '' THEN v_from_name ELSE contact_name END,
      updated_at = now()
  WHERE id = v_prospect_id;

  RETURN jsonb_build_object('outcome', v_outcome, 'conversationId', v_conversation_id, 'prospectId', v_prospect_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_gmail_sync_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'isRunning', s.is_running,
    'importFrom', s.import_from,
    'phase', s.phase,
    'lastSuccessAt', s.last_success_at,
    'lastError', s.last_error,
    'lastErrorAt', s.last_error_at,
    'consecutiveFailures', s.consecutive_failures,
    'connected', COALESCE(c.status = 'connected', false),
    'connectedAccount', c.connected_account
  )
  INTO v_result
  FROM public.gmail_sync_state s
  LEFT JOIN public.google_workspace_connections c ON c.mailbox_address = s.mailbox_address
  WHERE s.id = 1;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_gmail_sync(p_running boolean, p_import_from timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := public.current_staff_id();
  v_state public.gmail_sync_state%ROWTYPE;
  v_connected boolean;
  v_resets boolean := p_import_from IS NOT NULL;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF p_import_from IS NOT NULL AND p_import_from > now() THEN
    RAISE EXCEPTION 'La fecha inicial no puede estar en el futuro.';
  END IF;

  SELECT * INTO v_state FROM public.gmail_sync_state WHERE id = 1 FOR UPDATE;
  SELECT COALESCE(c.status = 'connected', false) INTO v_connected
  FROM public.google_workspace_connections c
  WHERE c.mailbox_address = v_state.mailbox_address;

  IF p_running AND NOT COALESCE(v_connected, false) THEN
    RAISE EXCEPTION 'Conecte primero la cuenta de Google antes de iniciar la sincronización.';
  END IF;

  UPDATE public.gmail_sync_state
  SET is_running = p_running,
      import_from = CASE
        WHEN p_import_from IS NOT NULL THEN p_import_from
        WHEN p_running AND import_from IS NULL THEN now()
        ELSE import_from
      END,
      phase = CASE
        WHEN v_resets THEN 'listing'
        WHEN p_running AND phase = 'idle' THEN 'listing'
        ELSE phase
      END,
      page_token = CASE WHEN v_resets THEN NULL ELSE page_token END,
      history_id = CASE WHEN v_resets THEN NULL ELSE history_id END,
      lease_until = NULL,
      consecutive_failures = CASE WHEN v_resets THEN 0 ELSE consecutive_failures END,
      updated_at = now()
  WHERE id = 1;

  INSERT INTO public.admin_audit_events (actor_id, action, target_id, detail)
  VALUES (
    v_actor,
    'gmail_sync.set',
    'gmail-sync',
    jsonb_build_object('running', p_running, 'importFrom', p_import_from)
  );

  RETURN public.admin_gmail_sync_status();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gmail_sync_scheduler_matches(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gmail_sync_tick() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gmail_sync_guard(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gmail_sync_claim() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gmail_sync_checkpoint(integer, text, text, text, boolean, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gmail_record_message(integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_gmail_sync_status() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_gmail_sync(boolean, timestamptz) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.gmail_sync_scheduler_matches(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gmail_sync_claim() TO service_role;
GRANT EXECUTE ON FUNCTION public.gmail_sync_checkpoint(integer, text, text, text, boolean, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.gmail_record_message(integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_gmail_sync_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_gmail_sync(boolean, timestamptz) TO authenticated;

DO $$
BEGIN
  PERFORM cron.schedule('gmail-sync-tick', '* * * * *', 'select public.gmail_sync_tick()');
END $$;
