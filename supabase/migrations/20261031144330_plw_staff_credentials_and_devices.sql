/*
# Staff credentials, login limits, office devices, and authentication audit

1. Plain-English summary
- Stores each agent's four-digit PIN and the administrator passcode only as salted bcrypt hashes, computed inside the database with pgcrypto.
- Adds server-side login checks: office device approval first, then the staff account, then the credential, with temporary lockouts after repeated failures.
- Adds one-time device enrollment codes created by an administrator, and approved office device records (only token hashes are stored).
- Adds an authentication audit log. Entries record outcomes only, never PINs or codes.
- Generic failure outcomes are returned to the login service, so the browser cannot tell a wrong PIN from a locked or disabled account.

2. New tables (no client access at all)
- staff_credentials: one hashed secret per staff profile, failed attempt count, and lock expiry.
- office_devices: approved office devices, identified by a hash of their token. Revocation keeps history.
- device_enrollments: hashed one-time enrollment codes with an expiry.
- auth_audit_events: login outcomes and reasons.

3. Functions
- staff_login: called only by the server login service with the service role.
- set_staff_secret: sets or resets a PIN or passcode. Validates format. Called only by the server admin service.
- link_staff_auth_user: connects a staff profile to its managed session account.
- enroll_office_device: exchanges a valid enrollment code for an approved device.
- public_agent_directory: lists agent names and whether each is enabled. Exposes no credentials.

4. Security
- RLS is enabled on every new table with no policies and no grants to anon or authenticated.
- Lock: 5 failed attempts lock the credential for 15 minutes.
- Passwords are never used as account passwords. Session creation happens through managed sign-in.

5. Important notes
- The administrator passcode must be at least 12 characters. PINs must be exactly four digits.
- Authentication outcomes are limited to: ok, denied, device_required, invalid.
*/

CREATE TABLE IF NOT EXISTS public.staff_credentials (
  staff_id text PRIMARY KEY REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pin', 'passcode')),
  secret_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.office_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  token_hash text NOT NULL UNIQUE,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_by text REFERENCES public.staff_profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.device_enrollments (
  code_hash text PRIMARY KEY,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  created_by text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.auth_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL CHECK (char_length(event_type) <= 40),
  staff_id text,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'denied', 'device_required', 'invalid')),
  detail text NOT NULL DEFAULT '' CHECK (char_length(detail) <= 120),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_audit_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.setting_int(p_key text, p_default integer)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT (s.value #>> '{}')::integer FROM public.settings s WHERE s.key = p_key),
    p_default
  )
$$;

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
  v_device_ok boolean;
  v_lock_threshold constant integer := 5;
  v_lock_duration constant interval := interval '15 minutes';
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.office_devices d
    WHERE d.token_hash = encode(extensions.digest(p_device_token, 'sha256'), 'hex')
      AND d.revoked_at IS NULL
  ) INTO v_device_ok;

  IF NOT COALESCE(v_device_ok, false) THEN
    INSERT INTO public.auth_audit_events (event_type, staff_id, outcome, detail)
    VALUES ('login', p_staff_id, 'device_required', 'device_not_enrolled');
    RETURN jsonb_build_object('status', 'device_required');
  END IF;

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

CREATE OR REPLACE FUNCTION public.set_staff_secret(
  p_actor_id text,
  p_staff_id text,
  p_kind text,
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_kind = 'pin' THEN
    IF p_secret IS NULL OR p_secret !~ '^[0-9]{4}$' THEN
      RAISE EXCEPTION 'El PIN debe tener exactamente cuatro dígitos.';
    END IF;
  ELSIF p_kind = 'passcode' THEN
    IF p_secret IS NULL OR char_length(p_secret) < 12 OR char_length(p_secret) > 200 THEN
      RAISE EXCEPTION 'La contraseña de administrador debe tener entre 12 y 200 caracteres.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Tipo de credencial no válido.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles s
    WHERE s.id = p_staff_id
      AND ((p_kind = 'pin' AND s.role = 'agent') OR (p_kind = 'passcode' AND s.role = 'admin'))
  ) THEN
    RAISE EXCEPTION 'El perfil no admite este tipo de credencial.';
  END IF;

  INSERT INTO public.staff_credentials (staff_id, kind, secret_hash, failed_attempts, locked_until, updated_at)
  VALUES (
    p_staff_id,
    p_kind,
    extensions.crypt(p_secret, extensions.gen_salt('bf', 10)),
    0,
    NULL,
    now()
  )
  ON CONFLICT (staff_id) DO UPDATE
  SET kind = EXCLUDED.kind,
      secret_hash = EXCLUDED.secret_hash,
      failed_attempts = 0,
      locked_until = NULL,
      updated_at = now();

  INSERT INTO public.admin_audit_events (actor_id, action, target_id, detail)
  VALUES (p_actor_id, 'credential.set', p_staff_id, jsonb_build_object('kind', p_kind));
END;
$$;

CREATE OR REPLACE FUNCTION public.link_staff_auth_user(p_staff_id text, p_auth_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.staff_profiles
  SET auth_user_id = p_auth_user_id, updated_at = now()
  WHERE id = p_staff_id AND auth_user_id IS NULL
$$;

CREATE OR REPLACE FUNCTION public.enroll_office_device(p_code text, p_label text, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hash text := encode(extensions.digest(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');
  v_enrollment public.device_enrollments%ROWTYPE;
  v_found boolean;
BEGIN
  SELECT * INTO v_enrollment
  FROM public.device_enrollments e
  WHERE e.code_hash = v_hash
    AND e.used_at IS NULL
    AND e.expires_at > now()
  FOR UPDATE;
  v_found := FOUND;

  IF NOT v_found THEN
    INSERT INTO public.auth_audit_events (event_type, outcome, detail)
    VALUES ('device_enrollment', 'invalid', 'code_not_valid');
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  UPDATE public.device_enrollments SET used_at = now() WHERE code_hash = v_hash;
  INSERT INTO public.office_devices (label, token_hash, created_by)
  VALUES (
    v_enrollment.label,
    encode(extensions.digest(p_token, 'sha256'), 'hex'),
    v_enrollment.created_by
  );
  INSERT INTO public.auth_audit_events (event_type, outcome, detail)
  VALUES ('device_enrollment', 'ok', 'device_approved');
  RETURN jsonb_build_object('status', 'ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.public_agent_directory()
RETURNS TABLE (id text, display_name text, is_enabled boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id, s.display_name, s.is_enabled
  FROM public.staff_profiles s
  WHERE s.role = 'agent'
  ORDER BY s.id
$$;

REVOKE EXECUTE ON FUNCTION public.setting_int(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_login(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_staff_secret(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_staff_auth_user(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enroll_office_device(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.public_agent_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_login(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_staff_secret(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_staff_auth_user(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.enroll_office_device(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_agent_directory() TO anon, authenticated;
