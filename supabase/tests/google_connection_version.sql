-- Regression checks for the authoritative Google connection version.
-- Runs inside a transaction that always rolls back.

DO $$
DECLARE
  v_mailbox constant text := 'plw@professionallatinoworker2026.com';
  v_user uuid := gen_random_uuid();
  v_staff text := 'agent-900003';
  v_session uuid := gen_random_uuid();
  v_version integer;
  v_result text;
  v_rows integer;
  v_ciphertext text;
  v_status text;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
  VALUES (v_user, 'authenticated', 'authenticated', 'race-test-' || v_user || '@example.invalid', now(), now());

  INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
  VALUES (v_session, v_user, clock_timestamp(), now());

  INSERT INTO public.staff_profiles (id, role, display_name, auth_user_id, is_enabled)
  VALUES (v_staff, 'admin', 'Prueba carrera Google', v_user, true);

  DELETE FROM public.google_workspace_connections WHERE mailbox_address = v_mailbox;
  INSERT INTO public.google_workspace_connections (mailbox_address, status) VALUES (v_mailbox, 'disconnected');

  -- Check 1: a live admin saves against the current version.
  v_result := public.save_google_connection(v_mailbox, 0, v_session, v_user, v_staff,
    '{"status":"connected","refresh_token_ciphertext":"cipher-1","scopes":["https://www.googleapis.com/auth/gmail.readonly"]}'::jsonb, NULL);
  IF v_result <> 'saved' THEN RAISE EXCEPTION 'check 1 failed: %', v_result; END IF;

  -- Check 2: disconnect advances the version, clears access, and returns the previous token.
  SELECT d.new_version, d.previous_ciphertext INTO v_version, v_ciphertext
  FROM public.disconnect_google_connection(v_mailbox, v_session, v_user, v_staff) AS d;
  IF v_version IS DISTINCT FROM 1 OR v_ciphertext IS DISTINCT FROM 'cipher-1' THEN
    RAISE EXCEPTION 'check 2 failed: version %, ciphertext %', v_version, v_ciphertext;
  END IF;
  SELECT c.status, c.refresh_token_ciphertext INTO v_status, v_ciphertext
  FROM public.google_workspace_connections c WHERE c.mailbox_address = v_mailbox;
  IF v_status <> 'disconnected' OR v_ciphertext IS NOT NULL THEN
    RAISE EXCEPTION 'check 2 failed: access not cleared (%, %)', v_status, v_ciphertext;
  END IF;

  -- Check 3: an older callback (version 0) cannot save after disconnect.
  v_result := public.save_google_connection(v_mailbox, 0, v_session, v_user, v_staff,
    '{"status":"connected","refresh_token_ciphertext":"late-cipher"}'::jsonb, NULL);
  IF v_result <> 'superseded' THEN RAISE EXCEPTION 'check 3 failed: %', v_result; END IF;
  SELECT c.refresh_token_ciphertext INTO v_ciphertext
  FROM public.google_workspace_connections c WHERE c.mailbox_address = v_mailbox;
  IF v_ciphertext IS NOT NULL THEN RAISE EXCEPTION 'check 3 failed: late token stored'; END IF;

  -- Check 4: a current-version save is refused when the status guard does not match.
  v_result := public.save_google_connection(v_mailbox, 1, v_session, v_user, v_staff,
    '{"last_error":"should not write"}'::jsonb, 'connected');
  IF v_result <> 'superseded' THEN RAISE EXCEPTION 'check 4 failed: %', v_result; END IF;

  -- Check 5: a revoked session cannot save or disconnect.
  DELETE FROM auth.sessions WHERE id = v_session;
  v_result := public.save_google_connection(v_mailbox, 1, v_session, v_user, v_staff,
    '{"status":"error","last_error":"x"}'::jsonb, NULL);
  IF v_result <> 'session-ended' THEN RAISE EXCEPTION 'check 5 failed: %', v_result; END IF;
  SELECT count(*) INTO v_rows FROM public.disconnect_google_connection(v_mailbox, v_session, v_user, v_staff);
  IF v_rows <> 0 THEN RAISE EXCEPTION 'check 5 failed: disconnect ran for a dead session'; END IF;

  RAISE EXCEPTION 'GOOGLE CONNECTION VERSION CHECKS PASSED (transaction rolled back)';
END $$;
