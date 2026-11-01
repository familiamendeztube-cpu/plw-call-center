/*
# Owner setup: server-side expiry and owner-device recovery

1. Plain-English summary
- Owner enrollment codes now expire 15 minutes after the server creates them. The server returns the exact expiry time.
- owner_bootstrap takes a code hash and a label only. The expiry is no longer supplied by the caller.
- owner_recover_device issues a fresh single-use code for the existing owner. It supersedes only unused owner-issued codes, keeps the administrator passcode, keeps registered devices, and keeps the owner_setup record.
- Both functions are callable only by the trusted server role.

2. Schema changes
- device_enrollments.issued_by_owner_setup marks codes issued by the owner setup or recovery, so administrator-issued codes are never superseded by recovery.

3. Security
- Both functions serialize on the same advisory lock as the first bootstrap.
- EXECUTE is revoked from PUBLIC, anon, and authenticated.
*/

ALTER TABLE public.device_enrollments
  ADD COLUMN IF NOT EXISTS issued_by_owner_setup boolean NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS public.owner_bootstrap(text, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.owner_bootstrap(
  p_passcode text,
  p_code_hash text,
  p_label text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_expires_at timestamptz := now() + interval '15 minutes';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('plw_owner_bootstrap'));

  IF EXISTS (SELECT 1 FROM public.owner_setup)
     OR EXISTS (SELECT 1 FROM public.staff_credentials WHERE staff_id = 'admin-1') THEN
    RETURN jsonb_build_object('status', 'already_completed');
  END IF;

  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'El código de registro no es válido.';
  END IF;

  IF NULLIF(btrim(COALESCE(p_label, '')), '') IS NULL OR char_length(btrim(p_label)) > 80 THEN
    RAISE EXCEPTION 'La etiqueta del dispositivo debe tener entre 1 y 80 caracteres.';
  END IF;

  PERFORM public.set_staff_secret('admin-1', 'admin-1', 'passcode', p_passcode);

  UPDATE public.staff_profiles
  SET is_enabled = true, updated_at = now()
  WHERE id = 'admin-1' AND role = 'admin';

  INSERT INTO public.device_enrollments (code_hash, label, created_by, expires_at, issued_by_owner_setup)
  VALUES (p_code_hash, btrim(p_label), 'admin-1', v_expires_at, true);

  INSERT INTO public.owner_setup (admin_staff_id) VALUES ('admin-1');

  INSERT INTO public.auth_audit_events (event_type, staff_id, outcome, detail)
  VALUES ('owner_bootstrap', 'admin-1', 'ok', 'owner_configured');

  RETURN jsonb_build_object('status', 'ok', 'expires_at', v_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_recover_device(p_code_hash text, p_label text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_expires_at timestamptz := now() + interval '15 minutes';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('plw_owner_bootstrap'));

  IF NOT EXISTS (SELECT 1 FROM public.owner_setup) THEN
    RETURN jsonb_build_object('status', 'not_configured');
  END IF;

  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'El código de registro no es válido.';
  END IF;

  IF NULLIF(btrim(COALESCE(p_label, '')), '') IS NULL OR char_length(btrim(p_label)) > 80 THEN
    RAISE EXCEPTION 'La etiqueta del dispositivo debe tener entre 1 y 80 caracteres.';
  END IF;

  UPDATE public.device_enrollments
  SET expires_at = now()
  WHERE issued_by_owner_setup
    AND used_at IS NULL
    AND expires_at > now();

  INSERT INTO public.device_enrollments (code_hash, label, created_by, expires_at, issued_by_owner_setup)
  VALUES (p_code_hash, btrim(p_label), 'admin-1', v_expires_at, true);

  INSERT INTO public.auth_audit_events (event_type, staff_id, outcome, detail)
  VALUES ('owner_recovery', 'admin-1', 'ok', 'device_code_reissued');

  RETURN jsonb_build_object('status', 'ok', 'expires_at', v_expires_at);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.owner_bootstrap(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.owner_recover_device(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_bootstrap(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_recover_device(text, text) TO service_role;
