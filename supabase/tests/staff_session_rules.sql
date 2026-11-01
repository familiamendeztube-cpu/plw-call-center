-- Regression checks for staff session authorization.
-- Runs inside a single DO block that always raises at the end, so every change is rolled back.
-- Expected result: the error message "ALL SESSION CHECKS PASSED (transaction rolled back)".

DO $test$
DECLARE
  admin_uid uuid := gen_random_uuid();
  target_uid uuid := gen_random_uuid();
  admin_session uuid := gen_random_uuid();
  old_session uuid := gen_random_uuid();
  new_session uuid := gen_random_uuid();
  found_count integer;
  found_staff text;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
  VALUES
    (admin_uid, 'authenticated', 'authenticated', 'session-test-admin-' || admin_uid || '@example.invalid', now(), now()),
    (target_uid, 'authenticated', 'authenticated', 'session-test-agent-' || target_uid || '@example.invalid', now(), now());

  INSERT INTO public.staff_profiles (id, role, display_name, auth_user_id, is_enabled)
  VALUES
    ('agent-900001', 'admin', 'Prueba administradora', admin_uid, true),
    ('agent-900002', 'agent', 'Prueba agente', target_uid, true);

  INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
  VALUES
    (admin_session, admin_uid, clock_timestamp(), now()),
    (old_session, target_uid, clock_timestamp(), now());

  SELECT count(*) INTO found_count FROM public.resolve_staff_session(old_session, target_uid);
  IF found_count <> 1 THEN RAISE EXCEPTION 'FAIL 1: an active session must resolve'; END IF;

  PERFORM public.revoke_staff_sessions('agent-900002');

  -- A refreshed token keeps its session id. Simulate a surviving session row that predates the revocation.
  INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
  VALUES (old_session, target_uid, now() - interval '1 day', now());

  SELECT count(*) INTO found_count FROM public.resolve_staff_session(old_session, target_uid);
  IF found_count <> 0 THEN RAISE EXCEPTION 'FAIL 2: a refreshed session from before revocation must not resolve'; END IF;

  SELECT count(*) INTO found_count FROM public.resolve_staff_session(admin_session, admin_uid);
  IF found_count <> 1 THEN RAISE EXCEPTION 'FAIL 3: revoking a staff member must not end the administrator session'; END IF;

  INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
  VALUES (new_session, target_uid, clock_timestamp(), now());

  SELECT count(*) INTO found_count FROM public.resolve_staff_session(new_session, target_uid);
  IF found_count <> 1 THEN RAISE EXCEPTION 'FAIL 4: a new sign-in after revocation must resolve'; END IF;

  DELETE FROM auth.sessions WHERE id = new_session;
  SELECT count(*) INTO found_count FROM public.resolve_staff_session(new_session, target_uid);
  IF found_count <> 0 THEN RAISE EXCEPTION 'FAIL 5: a logged-out session must not resolve'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_uid::text, 'session_id', admin_session::text)::text, true);
  SELECT public.current_staff_id() INTO found_staff;
  IF found_staff IS DISTINCT FROM 'agent-900001' THEN RAISE EXCEPTION 'FAIL 6: administrator session must identify the administrator'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'FAIL 7: administrator session must be admin'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', target_uid::text, 'session_id', old_session::text)::text, true);
  SELECT public.current_staff_id() INTO found_staff;
  IF found_staff IS NOT NULL THEN RAISE EXCEPTION 'FAIL 8: a revoked session must not identify any staff member'; END IF;

  RAISE EXCEPTION 'ALL SESSION CHECKS PASSED (transaction rolled back)';
END
$test$;
