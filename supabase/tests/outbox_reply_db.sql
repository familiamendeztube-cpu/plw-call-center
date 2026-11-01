-- DB tests (not mocked): outbox and reply access controls on the live database.
-- Checks constraints, RLS, grants, and EXECUTE privileges by reading the catalog.
-- Runs inside a DO block that always raises a sentinel, so nothing is written.
-- Behavioral checks of request_reply_send need a signed-in staff session and are not covered here.

DO $$
DECLARE
  v_fn text;
  v_fns text[] := ARRAY[
    'get_reply_target', 'request_reply_send', 'save_draft', 'draft_save_as',
    'reply_send_as', 'reply_target_for', 'reply_address_ok', 'outbox_actor_allowed',
    'gmail_outbox_claim', 'gmail_outbox_set_headers', 'gmail_outbox_settle'
  ];
  v_count integer;
  v_exists boolean;
BEGIN
  -- Check 1: the outbox table has row level security enabled.
  SELECT c.relrowsecurity INTO v_exists FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'gmail_outbox';
  IF v_exists IS NOT TRUE THEN RAISE EXCEPTION 'check 1 failed: RLS is off on gmail_outbox'; END IF;

  -- Check 2: request IDs, outbound Message-IDs, and internal Message-IDs are unique.
  FOREACH v_fn IN ARRAY ARRAY['request_id', 'rfc_message_id', 'message_id'] LOOP
    SELECT count(*) INTO v_count FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'gmail_outbox'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
      AND indexdef ILIKE '%(' || v_fn || ')%';
    IF v_count < 1 THEN RAISE EXCEPTION 'check 2 failed: no unique index on gmail_outbox(%)', v_fn; END IF;
  END LOOP;

  -- Check 3: a Gmail thread can map to several customer keys (composite primary key).
  SELECT count(*) INTO v_count
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN LATERAL unnest(con.conkey) AS k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
  WHERE n.nspname = 'public' AND c.relname = 'gmail_threads' AND con.contype = 'p'
    AND a.attname = 'customer_key';
  IF v_count <> 1 THEN RAISE EXCEPTION 'check 3 failed: gmail_threads primary key lacks customer_key'; END IF;

  -- Check 4: anon and PUBLIC cannot execute any reply, draft, or outbox function.
  FOREACH v_fn IN ARRAY v_fns LOOP
    SELECT count(*) INTO v_count FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_fn
      AND has_function_privilege('anon', p.oid, 'EXECUTE');
    IF v_count <> 0 THEN RAISE EXCEPTION 'check 4 failed: anon can execute %', v_fn; END IF;
  END LOOP;

  -- Check 5: the internal ownership and outbox helpers are not callable by signed-in staff or the service role.
  FOREACH v_fn IN ARRAY ARRAY['outbox_actor_allowed', 'reply_address_ok', 'reply_target_for', 'reply_send_as', 'draft_save_as'] LOOP
    SELECT count(*) INTO v_count FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_fn
      AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
           OR has_function_privilege('service_role', p.oid, 'EXECUTE'));
    IF v_count <> 0 THEN RAISE EXCEPTION 'check 5 failed: internal helper % is callable', v_fn; END IF;
  END LOOP;

  -- Check 6: the worker functions are callable only by the service role.
  FOREACH v_fn IN ARRAY ARRAY['gmail_outbox_claim', 'gmail_outbox_set_headers', 'gmail_outbox_settle'] LOOP
    SELECT count(*) INTO v_count FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_fn
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
    IF v_count <> 0 THEN RAISE EXCEPTION 'check 6 failed: staff can execute %', v_fn; END IF;
  END LOOP;

  -- Check 7: staff cannot write to the outbox table directly.
  IF has_table_privilege('authenticated', 'public.gmail_outbox', 'INSERT')
     OR has_table_privilege('authenticated', 'public.gmail_outbox', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.gmail_outbox', 'DELETE') THEN
    RAISE EXCEPTION 'check 7 failed: staff can write gmail_outbox directly';
  END IF;

  -- Check 8: anon has no access to the outbox or draft tables.
  IF has_table_privilege('anon', 'public.gmail_outbox', 'SELECT')
     OR has_table_privilege('anon', 'public.drafts', 'SELECT') THEN
    RAISE EXCEPTION 'check 8 failed: anon can read outbox or drafts';
  END IF;

  -- Check 9: staff can read drafts only through a row policy (drafts have RLS enabled).
  SELECT c.relrowsecurity INTO v_exists FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'drafts';
  IF v_exists IS NOT TRUE THEN RAISE EXCEPTION 'check 9 failed: RLS is off on drafts'; END IF;

  RAISE EXCEPTION 'OUTBOX REPLY DB CHECKS PASSED (transaction rolled back)';
END $$;
