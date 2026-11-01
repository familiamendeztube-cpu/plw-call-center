/*
# Gmail sync: per-run fencing tokens, durable page progress, and contact fields

1. Plain-English summary
- Every sync run receives its own secret token when it starts. Each write (checkpoint or imported message) must present that token, the live lease, and the current Google connection version.
- Pausing, changing the import date, starting a new run, or disconnecting Google clears the token, so an old worker can no longer write.
- The list of message IDs still waiting on the current Gmail page is saved after each message, so an interrupted run resumes at the next unfinished message.
- Imported messages carry separate customer contact fields, so a website notification records the customer rather than the notification sender.

2. Changed objects
- gmail_sync_state: new columns run_token, pending_ids, target_history_id.
- google_workspace_connections: trigger gmail_sync_invalidate_runs clears the run token and lease when status or connection version changes.
- gmail_sync_guard(version, token): new signature; requires the token, live lease, connected status, and matching version.
- gmail_sync_claim(): issues a new run token and returns the saved page position.
- gmail_sync_checkpoint(...): new signature with token, pending IDs, and target history cursor. Old signature removed.
- gmail_record_message(version, token, message): new signature with customer contact fields. Old signature removed.
- admin_set_gmail_sync: locks the connection row before the sync state row and clears any run token.
- admin_gmail_sync_status: adds leaseActive.

3. Security
- Lock order is always the connection row first, then the sync state row, for every writer and for administrator changes.
- Old writable signatures are removed, so no path writes without the token check.
- Access is unchanged: the server role runs the sync functions; administrators read status and change the sync setting.

4. Important notes
- Existing sync progress is kept. A run interrupted before this migration resumes from its saved phase with a new token.
*/

ALTER TABLE public.gmail_sync_state
  ADD COLUMN IF NOT EXISTS run_token uuid,
  ADD COLUMN IF NOT EXISTS pending_ids text[],
  ADD COLUMN IF NOT EXISTS target_history_id text;

DROP FUNCTION IF EXISTS public.gmail_record_message(integer, jsonb);
DROP FUNCTION IF EXISTS public.gmail_sync_checkpoint(integer, text, text, text, boolean, text, boolean);
DROP FUNCTION IF EXISTS public.gmail_sync_guard(integer);

CREATE OR REPLACE FUNCTION public.gmail_sync_guard(p_version integer, p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mailbox text;
BEGIN
  SELECT s.mailbox_address INTO v_mailbox FROM public.gmail_sync_state s WHERE s.id = 1;
  PERFORM 1 FROM public.google_workspace_connections c
  WHERE c.mailbox_address = v_mailbox
  FOR SHARE;
  PERFORM 1 FROM public.gmail_sync_state s WHERE s.id = 1 FOR UPDATE;

  RETURN EXISTS (
    SELECT 1
    FROM public.gmail_sync_state s
    JOIN public.google_workspace_connections c ON c.mailbox_address = s.mailbox_address
    WHERE s.id = 1
      AND s.is_running
      AND p_token IS NOT NULL
      AND s.run_token = p_token
      AND s.lease_until > now()
      AND c.status = 'connected'
      AND c.connection_version = p_version
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.gmail_sync_invalidate_runs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.connection_version IS DISTINCT FROM OLD.connection_version THEN
    UPDATE public.gmail_sync_state
    SET run_token = NULL, lease_until = NULL, updated_at = now()
    WHERE id = 1 AND mailbox_address = NEW.mailbox_address;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gmail_sync_invalidate_runs ON public.google_workspace_connections;
CREATE TRIGGER gmail_sync_invalidate_runs
AFTER UPDATE ON public.google_workspace_connections
FOR EACH ROW EXECUTE FUNCTION public.gmail_sync_invalidate_runs();

CREATE OR REPLACE FUNCTION public.gmail_sync_claim()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mailbox text;
  v_state public.gmail_sync_state%ROWTYPE;
  v_version integer;
  v_status text;
  v_phase text;
  v_token uuid := gen_random_uuid();
BEGIN
  SELECT s.mailbox_address INTO v_mailbox FROM public.gmail_sync_state s WHERE s.id = 1;
  SELECT c.connection_version, c.status INTO v_version, v_status
  FROM public.google_workspace_connections c
  WHERE c.mailbox_address = v_mailbox
  FOR SHARE;

  SELECT * INTO v_state FROM public.gmail_sync_state WHERE id = 1 FOR UPDATE;
  IF NOT v_state.is_running THEN RETURN NULL; END IF;
  IF v_state.lease_until IS NOT NULL AND v_state.lease_until > now() THEN RETURN NULL; END IF;
  IF v_status IS DISTINCT FROM 'connected' THEN RETURN NULL; END IF;

  v_phase := CASE WHEN v_state.phase = 'idle' THEN 'listing' ELSE v_state.phase END;
  UPDATE public.gmail_sync_state
  SET run_token = v_token,
      lease_until = now() + interval '3 minutes',
      phase = v_phase,
      updated_at = now()
  WHERE id = 1;

  RETURN jsonb_build_object(
    'runToken', v_token,
    'connectionVersion', v_version,
    'phase', v_phase,
    'pageToken', v_state.page_token,
    'historyId', v_state.history_id,
    'pending', v_state.pending_ids,
    'targetHistoryId', v_state.target_history_id,
    'importFrom', v_state.import_from
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.gmail_sync_checkpoint(
  p_version integer,
  p_token uuid,
  p_phase text,
  p_page_token text,
  p_history_id text,
  p_pending text[],
  p_target_history_id text,
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
  IF NOT public.gmail_sync_guard(p_version, p_token) THEN RETURN false; END IF;

  UPDATE public.gmail_sync_state
  SET phase = p_phase,
      page_token = p_page_token,
      history_id = p_history_id,
      pending_ids = p_pending,
      target_history_id = p_target_history_id,
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
      run_token = CASE WHEN p_release THEN NULL ELSE run_token END,
      updated_at = now()
  WHERE id = 1;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.gmail_record_message(p_version integer, p_token uuid, p_message jsonb)
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
  v_contact_email text := left(btrim(COALESCE(p_message->>'contactEmail', '')), 254);
  v_contact_name text := left(btrim(COALESCE(p_message->>'contactName', '')), 160);
  v_contact_phone text := left(btrim(COALESCE(p_message->>'contactPhone', '')), 40);
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
      COALESCE(NULLIF(v_contact_name, ''), NULLIF(v_contact_email, ''), NULLIF(v_contact_phone, ''), 'Consulta por correo'),
      v_contact_name,
      v_contact_email,
      v_contact_phone,
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
  SET email = CASE WHEN email = '' THEN v_contact_email ELSE email END,
      contact_name = CASE WHEN contact_name = '' THEN v_contact_name ELSE contact_name END,
      phone = CASE WHEN phone = '' THEN v_contact_phone ELSE phone END,
      updated_at = now()
  WHERE id = v_prospect_id;

  RETURN jsonb_build_object('outcome', v_outcome, 'conversationId', v_conversation_id, 'prospectId', v_prospect_id);
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
  v_mailbox text;
  v_connected boolean;
  v_resets boolean := p_import_from IS NOT NULL;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF p_import_from IS NOT NULL AND p_import_from > now() THEN
    RAISE EXCEPTION 'La fecha inicial no puede estar en el futuro.';
  END IF;

  SELECT s.mailbox_address INTO v_mailbox FROM public.gmail_sync_state s WHERE s.id = 1;
  SELECT COALESCE(c.status = 'connected', false) INTO v_connected
  FROM public.google_workspace_connections c
  WHERE c.mailbox_address = v_mailbox
  FOR SHARE;

  PERFORM 1 FROM public.gmail_sync_state s WHERE s.id = 1 FOR UPDATE;

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
      pending_ids = CASE WHEN v_resets THEN NULL ELSE pending_ids END,
      target_history_id = CASE WHEN v_resets THEN NULL ELSE target_history_id END,
      lease_until = NULL,
      run_token = NULL,
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
    'leaseActive', COALESCE(s.lease_until > now(), false),
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

REVOKE EXECUTE ON FUNCTION public.gmail_sync_guard(integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gmail_sync_invalidate_runs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gmail_sync_claim() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gmail_sync_checkpoint(integer, uuid, text, text, text, text[], text, boolean, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gmail_record_message(integer, uuid, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.gmail_sync_claim() TO service_role;
GRANT EXECUTE ON FUNCTION public.gmail_sync_checkpoint(integer, uuid, text, text, text, text[], text, boolean, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.gmail_record_message(integer, uuid, jsonb) TO service_role;
