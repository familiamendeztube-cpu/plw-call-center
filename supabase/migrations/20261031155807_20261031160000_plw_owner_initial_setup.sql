/*
# Owner initial setup from the protected setup screen

1. Plain-English summary
- The first administrator is now created from inside the app, not from a terminal.
- One database operation sets the administrator passcode, enables the administrator, registers the first computer with its device token hash, records the permanent owner-setup marker, and writes an audit event. All of it succeeds or none of it does.
- Setup can run only once. Later attempts return "already_completed" and change nothing.
- Failed passcode attempts are counted in the authentication audit log. Five failures in 15 minutes temporarily block further attempts.

2. Functions
- owner_setup_status(): reports whether setup has already completed.
- owner_setup_is_throttled(): reports whether too many recent failures block attempts.
- owner_setup_record_failure(): records one failed passcode attempt (outcome only, no secret values).
- owner_initial_setup(p_passcode, p_device_token_hash, p_label): performs the full setup in one transaction.
- owner_bootstrap(text, text, text): removed. Its only caller was the terminal script, which is being replaced.

3. Security
- Every function is executable only by the trusted server role (service_role). Anonymous and signed-in browser users cannot call them.
- The passcode is never stored in plain text. It is hashed by the existing set_staff_secret routine.
- The setup function takes the same advisory lock as recovery, so concurrent setup attempts are serialized and only one can succeed.

4. Important notes
- The server verifies the entered passcode against the private setup secret before calling owner_initial_setup. This migration does not read that secret.
- The device token itself is never stored. Only its SHA-256 hash is stored, matching how other office devices are recorded.
*/

CREATE OR REPLACE FUNCTION public.owner_setup_status()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.owner_setup)
      OR EXISTS (SELECT 1 FROM public.staff_credentials WHERE staff_id = 'admin-1')
$$;

CREATE OR REPLACE FUNCTION public.owner_setup_is_throttled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (
    SELECT count(*)
    FROM public.auth_audit_events e
    WHERE e.event_type = 'owner_setup'
      AND e.outcome = 'denied'
      AND e.occurred_at > now() - interval '15 minutes'
  ) >= 5
$$;

CREATE OR REPLACE FUNCTION public.owner_setup_record_failure()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.auth_audit_events (event_type, staff_id, outcome, detail)
  VALUES ('owner_setup', 'admin-1', 'denied', 'passcode_mismatch')
$$;

CREATE OR REPLACE FUNCTION public.owner_initial_setup(
  p_passcode text,
  p_device_token_hash text,
  p_label text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('plw_owner_bootstrap'));

  IF public.owner_setup_status() THEN
    RETURN jsonb_build_object('status', 'already_completed');
  END IF;

  IF p_device_token_hash IS NULL OR p_device_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'El identificador del equipo no es válido.';
  END IF;

  IF NULLIF(btrim(COALESCE(p_label, '')), '') IS NULL OR char_length(btrim(p_label)) > 80 THEN
    RAISE EXCEPTION 'El nombre del equipo debe tener entre 1 y 80 caracteres.';
  END IF;

  PERFORM public.set_staff_secret('admin-1', 'admin-1', 'passcode', p_passcode);

  UPDATE public.staff_profiles
  SET is_enabled = true, updated_at = now()
  WHERE id = 'admin-1' AND role = 'admin';

  INSERT INTO public.office_devices (label, token_hash, created_by)
  VALUES (btrim(p_label), p_device_token_hash, 'admin-1');

  INSERT INTO public.owner_setup (admin_staff_id) VALUES ('admin-1');

  INSERT INTO public.auth_audit_events (event_type, staff_id, outcome, detail)
  VALUES ('owner_setup', 'admin-1', 'ok', 'owner_configured_from_setup_screen');

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

DROP FUNCTION IF EXISTS public.owner_bootstrap(text, text, text);

REVOKE EXECUTE ON FUNCTION public.owner_setup_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.owner_setup_is_throttled() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.owner_setup_record_failure() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.owner_initial_setup(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_setup_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_setup_is_throttled() TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_setup_record_failure() TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_initial_setup(text, text, text) TO service_role;
