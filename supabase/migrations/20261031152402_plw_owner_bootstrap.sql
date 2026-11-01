/*
# Trusted first-owner bootstrap

1. Plain-English summary
- Adds a one-time owner setup that configures the first administrator without an existing administrator session.
- Runs in one transaction: sets the administrator passcode (hashed with the existing credential function), enables the administrator, creates a single-use device enrollment code (only its hash is stored), and records that setup is complete.
- Only the trusted server role can execute it. Anonymous and signed-in browser users cannot.

2. New tables
- owner_setup: a single row (enforced by the primary key) recording that the first owner was configured. It is never deleted, so the bootstrap cannot run again even if the administrator is later disabled.

3. Functions
- owner_bootstrap: called only with the service role by the owner setup script.

4. Security
- Advisory transaction lock serializes concurrent runs.
- RLS enabled on owner_setup with no policies and no browser grants.
*/

CREATE TABLE IF NOT EXISTS public.owner_setup (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  admin_staff_id text NOT NULL REFERENCES public.staff_profiles(id),
  completed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.owner_setup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_setup FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.owner_bootstrap(
  p_passcode text,
  p_code_hash text,
  p_label text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('plw_owner_bootstrap'));

  IF EXISTS (SELECT 1 FROM public.owner_setup)
     OR EXISTS (SELECT 1 FROM public.staff_credentials WHERE staff_id = 'admin-1') THEN
    RETURN jsonb_build_object('status', 'already_completed');
  END IF;

  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'El código de registro no es válido.';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'La vigencia del código de registro no es válida.';
  END IF;

  PERFORM public.set_staff_secret('admin-1', 'admin-1', 'passcode', p_passcode);

  UPDATE public.staff_profiles
  SET is_enabled = true, updated_at = now()
  WHERE id = 'admin-1' AND role = 'admin';

  INSERT INTO public.device_enrollments (code_hash, label, created_by, expires_at)
  VALUES (p_code_hash, p_label, 'admin-1', p_expires_at);

  INSERT INTO public.owner_setup (admin_staff_id) VALUES ('admin-1');

  INSERT INTO public.auth_audit_events (event_type, staff_id, outcome, detail)
  VALUES ('owner_bootstrap', 'admin-1', 'ok', 'owner_configured');

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.owner_bootstrap(text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_bootstrap(text, text, text, timestamptz) TO service_role;
