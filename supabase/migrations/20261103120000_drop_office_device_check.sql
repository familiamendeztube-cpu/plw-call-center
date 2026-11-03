/*
# Sign in without registering the computer

1. Plain-English summary
- Staff sign in with their PIN or passcode from any computer. The office computer check is removed from staff_login.
- The lockout stays: 5 failed attempts lock the credential for 15 minutes.

2. Changes
- staff_login: same signature, so the login service keeps working whichever deploys first. p_device_token is accepted and ignored.
- office_devices and device_enrollments are kept, unused, so the check can come back later.

3. Notes
- CREATE OR REPLACE keeps the existing grants: service_role only.
*/

CREATE OR REPLACE FUNCTION public.staff_login(
  p_kind text,
  p_staff_id text,
  p_secret text,
  p_device_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_staff public.staff_profiles%ROWTYPE;
  v_cred public.staff_credentials%ROWTYPE;
  v_staff_found boolean;
  v_cred_found boolean;
  v_lock_threshold constant integer := 5;
  v_lock_duration constant interval := interval '15 minutes';
BEGIN
  SELECT * INTO v_staff FROM public.staff_profiles WHERE id = p_staff_id;
  v_staff_found := FOUND;
  SELECT * INTO v_cred FROM public.staff_credentials WHERE staff_id = p_staff_id FOR UPDATE;
  v_cred_found := FOUND;

  IF NOT v_staff_found OR NOT v_cred_found
     OR (p_kind = 'pin' AND v_staff.role <> 'agent')
     OR (p_kind = 'passcode' AND v_staff.role <> 'admin') THEN
    INSERT INTO public.auth_audit_events (event_type, staff_id, outcome, detail)
    VALUES ('login', p_staff_id, 'denied', 'unknown_or_unconfigured');
    RETURN jsonb_build_object('status', 'denied');
  END IF;

  IF NOT v_staff.is_enabled THEN
    INSERT INTO public.auth_audit_events (event_type, staff_id, outcome, detail)
    VALUES ('login', p_staff_id, 'denied', 'account_disabled');
    RETURN jsonb_build_object('status', 'denied');
  END IF;

  IF v_cred.locked_until IS NOT NULL AND v_cred.locked_until > now() THEN
    INSERT INTO public.auth_audit_events (event_type, staff_id, outcome, detail)
    VALUES ('login', p_staff_id, 'denied', 'temporarily_locked');
    RETURN jsonb_build_object('status', 'denied');
  END IF;

  IF extensions.crypt(p_secret, v_cred.secret_hash) = v_cred.secret_hash THEN
    UPDATE public.staff_credentials
    SET failed_attempts = 0, locked_until = NULL, updated_at = now()
    WHERE staff_id = p_staff_id;
    INSERT INTO public.auth_audit_events (event_type, staff_id, outcome, detail)
    VALUES ('login', p_staff_id, 'ok', 'credential_verified');
    RETURN jsonb_build_object(
      'status', 'ok',
      'staff_id', v_staff.id,
      'role', v_staff.role,
      'auth_user_id', v_staff.auth_user_id,
      'display_name', v_staff.display_name
    );
  END IF;

  UPDATE public.staff_credentials
  SET failed_attempts = failed_attempts + 1,
      locked_until = CASE
        WHEN failed_attempts + 1 >= v_lock_threshold THEN now() + v_lock_duration
        ELSE locked_until
      END,
      updated_at = now()
  WHERE staff_id = p_staff_id;
  INSERT INTO public.auth_audit_events (event_type, staff_id, outcome, detail)
  VALUES ('login', p_staff_id, 'denied', 'credential_mismatch');
  RETURN jsonb_build_object('status', 'denied');
END;
$$;
