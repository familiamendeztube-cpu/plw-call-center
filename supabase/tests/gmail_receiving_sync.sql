-- Regression checks for Gmail intake, run fencing, round-robin assignment, trusted form contacts, and disconnect safety.
-- Runs inside a DO block that always raises a sentinel, so every write is rolled back.

DO $$
DECLARE
  v_mailbox constant text := 'plw@professionallatinoworker2026.com';
  v_user uuid;
  v_version integer;
  v_old_version integer;
  v_claim jsonb;
  v_token uuid;
  v_stale_token uuid;
  v_payload jsonb;
  v_result jsonb;
  v_queue_status text;
  v_owner text;
  v_thread_owner text;
  v_prospect_count integer;
  v_message_count integer;
  v_a integer;
  v_b integer;
  v_c integer;
  v_d integer;
  v_e integer;
  v_unassigned integer;
  v_drained integer;
  v_waiting uuid;
  v_unread boolean;
  v_pending text[];
  v_form_email text;
  v_form_phone text;
  v_form_name text;
  v_form_sender text;
  i integer;
BEGIN
  FOR i IN 1..5 LOOP
    v_user := gen_random_uuid();
    INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
    VALUES (v_user, 'authenticated', 'authenticated', 'gmail-test-' || v_user || '@example.invalid', now(), now());

    INSERT INTO public.staff_profiles (id, role, display_name, auth_user_id, is_enabled, max_active_prospects)
    VALUES ('agent-91000' || i, 'agent', 'Prueba Gmail ' || i, v_user, i <> 5, 3);

    INSERT INTO public.staff_presence (staff_id, availability, last_heartbeat_at, updated_at)
    VALUES ('agent-91000' || i, CASE WHEN i = 4 THEN 'paused' ELSE 'active' END, now(), now());
  END LOOP;

  DELETE FROM public.google_workspace_connections WHERE mailbox_address = v_mailbox;
  INSERT INTO public.google_workspace_connections (mailbox_address, status) VALUES (v_mailbox, 'connected');

  UPDATE public.gmail_sync_state
  SET is_running = true, phase = 'listing', page_token = NULL, history_id = NULL,
      pending_ids = NULL, target_history_id = NULL, run_token = NULL, lease_until = NULL,
      import_from = now() - interval '1 day'
  WHERE id = 1;

  -- Check 1: a claim issues a run token; the guard accepts that token and version only.
  v_claim := public.gmail_sync_claim();
  IF v_claim IS NULL THEN RAISE EXCEPTION 'check 1 failed: claim returned nothing'; END IF;
  v_token := (v_claim->>'runToken')::uuid;
  v_version := (v_claim->>'connectionVersion')::integer;
  IF NOT public.gmail_sync_guard(v_version, v_token) THEN RAISE EXCEPTION 'check 1 failed: guard rejected the current token'; END IF;
  IF public.gmail_sync_guard(v_version, gen_random_uuid()) THEN RAISE EXCEPTION 'check 1 failed: guard accepted a foreign token'; END IF;
  IF public.gmail_sync_guard(v_version, NULL) THEN RAISE EXCEPTION 'check 1 failed: guard accepted a missing token'; END IF;
  IF public.gmail_sync_guard(v_version - 1, v_token) THEN RAISE EXCEPTION 'check 1 failed: guard accepted an old version'; END IF;
  IF public.gmail_sync_claim() IS NOT NULL THEN RAISE EXCEPTION 'check 1 failed: a live lease was claimed twice'; END IF;

  -- Check 2: twelve new threads become three each for the four enabled agents, the paused one included.
  FOR i IN 1..12 LOOP
    v_payload := jsonb_build_object(
      'gmailMessageId', 'm-' || i, 'gmailThreadId', 't-' || i,
      'fromAddress', 'cliente' || i || '@example.invalid', 'fromName', 'Cliente ' || i,
      'replyTo', '', 'subject', 'Consulta ' || i, 'body', 'Hola ' || i,
      'sentAt', (now() - make_interval(mins => 20 - i))::text,
      'contactEmail', 'cliente' || i || '@example.invalid', 'contactName', 'Cliente ' || i, 'contactPhone', ''
    );
    v_result := public.gmail_record_message(v_version, v_token, v_payload);
    IF v_result->>'outcome' <> 'created' THEN
      RAISE EXCEPTION 'check 2 failed: thread % returned %', i, v_result->>'outcome';
    END IF;
  END LOOP;

  SELECT
    count(*) FILTER (WHERE p.owner_id = 'agent-910001'),
    count(*) FILTER (WHERE p.owner_id = 'agent-910002'),
    count(*) FILTER (WHERE p.owner_id = 'agent-910003'),
    count(*) FILTER (WHERE p.owner_id = 'agent-910004'),
    count(*) FILTER (WHERE p.owner_id = 'agent-910005'),
    count(*) FILTER (WHERE p.owner_id IS NULL)
  INTO v_a, v_b, v_c, v_d, v_e, v_unassigned
  FROM public.gmail_threads t
  JOIN public.prospects p ON p.id = t.prospect_id
  WHERE t.mailbox_address = v_mailbox;

  IF v_a <> 3 OR v_b <> 3 OR v_c <> 3 OR v_d <> 3 THEN
    RAISE EXCEPTION 'check 2 failed: distribution %/%/%/%', v_a, v_b, v_c, v_d;
  END IF;
  IF v_e <> 0 OR v_unassigned <> 0 THEN
    RAISE EXCEPTION 'check 2 failed: disabled agent received work (%, unassigned %)', v_e, v_unassigned;
  END IF;

  -- Check 3: a thirteenth thread waits because every enabled agent is full.
  v_result := public.gmail_record_message(v_version, v_token, jsonb_build_object(
    'gmailMessageId', 'm-13', 'gmailThreadId', 't-13',
    'fromAddress', 'cliente13@example.invalid', 'fromName', 'Cliente 13',
    'replyTo', '', 'subject', 'Consulta 13', 'body', 'Hola 13', 'sentAt', now()::text,
    'contactEmail', 'cliente13@example.invalid', 'contactName', 'Cliente 13', 'contactPhone', ''
  ));
  IF v_result->>'outcome' <> 'created' THEN RAISE EXCEPTION 'check 3 failed: %', v_result->>'outcome'; END IF;
  v_waiting := (v_result->>'prospectId')::uuid;

  SELECT q.status INTO v_queue_status FROM public.assignment_queue q WHERE q.prospect_id = v_waiting;
  IF v_queue_status <> 'waiting' THEN RAISE EXCEPTION 'check 3 failed: queue status %', v_queue_status; END IF;

  -- Check 4: a repeated message ID is a duplicate and adds nothing.
  SELECT count(*) INTO v_prospect_count FROM public.gmail_threads WHERE mailbox_address = v_mailbox;
  v_result := public.gmail_record_message(v_version, v_token, jsonb_build_object(
    'gmailMessageId', 'm-1', 'gmailThreadId', 't-1', 'fromAddress', 'cliente1@example.invalid',
    'fromName', 'Cliente 1', 'replyTo', '', 'subject', 'Consulta 1', 'body', 'Hola 1', 'sentAt', now()::text,
    'contactEmail', 'cliente1@example.invalid', 'contactName', 'Cliente 1', 'contactPhone', ''
  ));
  IF v_result->>'outcome' <> 'duplicate' THEN RAISE EXCEPTION 'check 4 failed: %', v_result->>'outcome'; END IF;
  SELECT count(*) INTO v_message_count FROM public.gmail_messages WHERE mailbox_address = v_mailbox AND gmail_message_id = 'm-1';
  IF v_message_count <> 1 THEN RAISE EXCEPTION 'check 4 failed: message stored % times', v_message_count; END IF;
  IF (SELECT count(*) FROM public.gmail_threads WHERE mailbox_address = v_mailbox) <> v_prospect_count THEN
    RAISE EXCEPTION 'check 4 failed: duplicate created a thread';
  END IF;

  -- Check 5: a reply keeps the thread owner, creates no customer, and marks the conversation unread.
  SELECT p.owner_id INTO v_thread_owner
  FROM public.gmail_threads t JOIN public.prospects p ON p.id = t.prospect_id
  WHERE t.mailbox_address = v_mailbox AND t.gmail_thread_id = 't-2';

  UPDATE public.conversations SET unread = false
  WHERE id = (SELECT conversation_id FROM public.gmail_threads WHERE mailbox_address = v_mailbox AND gmail_thread_id = 't-2');

  v_result := public.gmail_record_message(v_version, v_token, jsonb_build_object(
    'gmailMessageId', 'm-2-reply', 'gmailThreadId', 't-2', 'fromAddress', 'cliente2@example.invalid',
    'fromName', 'Cliente 2', 'replyTo', '', 'subject', 'Re: Consulta 2', 'body', 'Seguimiento', 'sentAt', now()::text,
    'contactEmail', 'cliente2@example.invalid', 'contactName', 'Cliente 2', 'contactPhone', ''
  ));
  IF v_result->>'outcome' <> 'reply' THEN RAISE EXCEPTION 'check 5 failed: %', v_result->>'outcome'; END IF;

  SELECT p.owner_id, c.unread INTO v_owner, v_unread
  FROM public.gmail_threads t
  JOIN public.prospects p ON p.id = t.prospect_id
  JOIN public.conversations c ON c.id = t.conversation_id
  WHERE t.mailbox_address = v_mailbox AND t.gmail_thread_id = 't-2';
  IF v_owner IS DISTINCT FROM v_thread_owner THEN RAISE EXCEPTION 'check 5 failed: reply changed owner'; END IF;
  IF NOT v_unread THEN RAISE EXCEPTION 'check 5 failed: conversation not marked unread'; END IF;
  IF (SELECT count(*) FROM public.gmail_threads WHERE mailbox_address = v_mailbox) <> v_prospect_count THEN
    RAISE EXCEPTION 'check 5 failed: reply created a customer';
  END IF;

  -- Check 6: raising one agent's limit drains the waiting thread to that agent.
  UPDATE public.staff_profiles SET max_active_prospects = 5 WHERE id = 'agent-910001';
  v_drained := public.process_waiting_queue();
  IF v_drained <> 1 THEN RAISE EXCEPTION 'check 6 failed: drained %', v_drained; END IF;
  SELECT p.owner_id INTO v_owner FROM public.prospects p WHERE p.id = v_waiting;
  IF v_owner IS DISTINCT FROM 'agent-910001' THEN RAISE EXCEPTION 'check 6 failed: owner %', v_owner; END IF;

  -- Check 7: a durable page position is saved only with the live token; a pause clears it.
  IF NOT public.gmail_sync_checkpoint(v_version, v_token, 'listing', '4', 'h-1', ARRAY['a', 'b']::text[], 'h-2', false, NULL, false) THEN
    RAISE EXCEPTION 'check 7 failed: live checkpoint refused';
  END IF;
  IF public.gmail_sync_checkpoint(v_version, gen_random_uuid(), 'listing', '9', 'h-x', ARRAY['z']::text[], 'h-x', false, NULL, false) THEN
    RAISE EXCEPTION 'check 7 failed: foreign token wrote a checkpoint';
  END IF;
  SELECT s.pending_ids INTO v_pending FROM public.gmail_sync_state s WHERE s.id = 1;
  IF v_pending IS DISTINCT FROM ARRAY['a', 'b']::text[] THEN RAISE EXCEPTION 'check 7 failed: pending page changed to %', v_pending; END IF;

  UPDATE public.gmail_sync_state SET is_running = false, run_token = NULL, lease_until = NULL WHERE id = 1;
  IF public.gmail_sync_guard(v_version, v_token) THEN RAISE EXCEPTION 'check 7 failed: paused run still guarded'; END IF;
  IF public.gmail_sync_checkpoint(v_version, v_token, 'listing', '5', 'h-3', NULL, NULL, false, NULL, false) THEN
    RAISE EXCEPTION 'check 7 failed: paused run still checkpointed';
  END IF;
  v_result := public.gmail_record_message(v_version, v_token, jsonb_build_object(
    'gmailMessageId', 'm-paused', 'gmailThreadId', 't-paused', 'fromAddress', 'paused@example.invalid',
    'fromName', 'Pausa', 'replyTo', '', 'subject', 'Pausa', 'body', 'Pausa', 'sentAt', now()::text,
    'contactEmail', 'paused@example.invalid', 'contactName', 'Pausa', 'contactPhone', ''
  ));
  IF v_result->>'outcome' <> 'stale' THEN RAISE EXCEPTION 'check 7 failed: paused import outcome %', v_result->>'outcome'; END IF;

  UPDATE public.gmail_sync_state SET is_running = true WHERE id = 1;
  v_claim := public.gmail_sync_claim();
  IF v_claim IS NULL THEN RAISE EXCEPTION 'check 7 failed: resume could not claim'; END IF;
  IF jsonb_array_length(v_claim->'pending') <> 2 OR v_claim->'pending'->>0 <> 'a' THEN
    RAISE EXCEPTION 'check 7 failed: resume lost the saved page position';
  END IF;
  IF (v_claim->>'runToken')::uuid = v_token THEN RAISE EXCEPTION 'check 7 failed: resume reused the old token'; END IF;
  v_stale_token := v_token;
  v_token := (v_claim->>'runToken')::uuid;

  -- Check 8: lease takeover invalidates the older worker's token everywhere.
  v_stale_token := v_token;
  UPDATE public.gmail_sync_state SET lease_until = now() - interval '1 minute' WHERE id = 1;
  v_claim := public.gmail_sync_claim();
  IF v_claim IS NULL THEN RAISE EXCEPTION 'check 8 failed: expired lease was not taken over'; END IF;
  IF public.gmail_sync_guard(v_version, v_stale_token) THEN RAISE EXCEPTION 'check 8 failed: old worker still guarded'; END IF;
  IF public.gmail_sync_checkpoint(v_version, v_stale_token, 'listing', NULL, NULL, NULL, NULL, false, NULL, false) THEN
    RAISE EXCEPTION 'check 8 failed: old worker still checkpoints';
  END IF;
  v_result := public.gmail_record_message(v_version, v_stale_token, jsonb_build_object(
    'gmailMessageId', 'm-old', 'gmailThreadId', 't-old', 'fromAddress', 'old@example.invalid',
    'fromName', 'Viejo', 'replyTo', '', 'subject', 'Viejo', 'body', 'Viejo', 'sentAt', now()::text,
    'contactEmail', 'old@example.invalid', 'contactName', 'Viejo', 'contactPhone', ''
  ));
  IF v_result->>'outcome' <> 'stale' THEN RAISE EXCEPTION 'check 8 failed: old worker imported %', v_result->>'outcome'; END IF;
  v_token := (v_claim->>'runToken')::uuid;
  IF NOT public.gmail_sync_guard(v_version, v_token) THEN RAISE EXCEPTION 'check 8 failed: new owner rejected'; END IF;

  -- Check 9: a trusted form notification records the customer, not the notification sender.
  v_result := public.gmail_record_message(v_version, v_token, jsonb_build_object(
    'gmailMessageId', 'm-form', 'gmailThreadId', 't-form', 'fromAddress', 'forms@sitio.example',
    'fromName', 'Formulario Web', 'replyTo', 'carla@negocio.com', 'subject', 'Nuevo contacto',
    'body', 'Nombre: Carla Ruiz', 'sentAt', now()::text,
    'contactEmail', 'carla@negocio.com', 'contactName', 'Carla Ruiz', 'contactPhone', '+1 305 555 0199'
  ));
  IF v_result->>'outcome' <> 'created' THEN RAISE EXCEPTION 'check 9 failed: %', v_result->>'outcome'; END IF;
  SELECT p.email, p.phone, p.contact_name INTO v_form_email, v_form_phone, v_form_name
  FROM public.gmail_threads t JOIN public.prospects p ON p.id = t.prospect_id
  WHERE t.mailbox_address = v_mailbox AND t.gmail_thread_id = 't-form';
  SELECT m.from_address INTO v_form_sender FROM public.gmail_messages m
  WHERE m.mailbox_address = v_mailbox AND m.gmail_message_id = 'm-form';
  IF v_form_email <> 'carla@negocio.com' THEN RAISE EXCEPTION 'check 9 failed: customer email %', v_form_email; END IF;
  IF v_form_phone <> '+1 305 555 0199' OR v_form_name <> 'Carla Ruiz' THEN RAISE EXCEPTION 'check 9 failed: contact details lost'; END IF;
  IF v_form_sender <> 'forms@sitio.example' THEN RAISE EXCEPTION 'check 9 failed: sender not kept on the message'; END IF;

  -- Check 10: a disconnect clears the token; a late import or checkpoint writes nothing.
  v_old_version := v_version;
  UPDATE public.google_workspace_connections
  SET status = 'disconnected', connection_version = connection_version + 1
  WHERE mailbox_address = v_mailbox
  RETURNING connection_version INTO v_version;

  IF (SELECT s.run_token FROM public.gmail_sync_state s WHERE s.id = 1) IS NOT NULL THEN
    RAISE EXCEPTION 'check 10 failed: disconnect left a run token behind';
  END IF;
  IF public.gmail_sync_guard(v_old_version, v_token) THEN RAISE EXCEPTION 'check 10 failed: guard still open'; END IF;
  IF public.gmail_sync_claim() IS NOT NULL THEN RAISE EXCEPTION 'check 10 failed: disconnected mailbox was claimed'; END IF;
  IF public.gmail_sync_checkpoint(v_old_version, v_token, 'incremental', NULL, 'h-late', NULL, NULL, true, NULL, true) THEN
    RAISE EXCEPTION 'check 10 failed: late checkpoint accepted';
  END IF;
  v_result := public.gmail_record_message(v_old_version, v_token, jsonb_build_object(
    'gmailMessageId', 'm-99', 'gmailThreadId', 't-99', 'fromAddress', 'late@example.invalid',
    'fromName', 'Tarde', 'replyTo', '', 'subject', 'Tarde', 'body', 'Tarde', 'sentAt', now()::text,
    'contactEmail', 'late@example.invalid', 'contactName', 'Tarde', 'contactPhone', ''
  ));
  IF v_result->>'outcome' <> 'stale' THEN RAISE EXCEPTION 'check 10 failed: %', v_result->>'outcome'; END IF;
  IF EXISTS (SELECT 1 FROM public.gmail_messages WHERE gmail_message_id = 'm-99')
     OR EXISTS (SELECT 1 FROM public.gmail_threads WHERE gmail_thread_id = 't-99') THEN
    RAISE EXCEPTION 'check 10 failed: stale import wrote data';
  END IF;

  RAISE EXCEPTION 'GMAIL RECEIVING SYNC CHECKS PASSED (transaction rolled back)';
END $$;
