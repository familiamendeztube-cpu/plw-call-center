/*
# Secretaria IA demo on Kike Code previews: 3 conversations per Kike preview link too

A site an agent builds in Kike Code gets the same Secretaria demo as a Call Center sample.
Its draft lives in PLW's main project, so here it has no prospect_site_drafts row: its demo
sessions are counted by its preview token ("kike-<64 hex>") instead of a draft id.

1. plw_secretary_demo_sessions: draft_id becomes optional and kike_token is added; every row
   has exactly one of them.
2. claim_secretary_kike_demo_session(token, limit): the per-token twin of
   claim_secretary_demo_session, under the same kind of lock. service_role only.
*/

ALTER TABLE public.plw_secretary_demo_sessions
  ALTER COLUMN draft_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS kike_token text CHECK (kike_token ~ '^kike-[0-9a-f]{64}$');

ALTER TABLE public.plw_secretary_demo_sessions
  DROP CONSTRAINT IF EXISTS plw_secretary_demo_sessions_one_source,
  ADD CONSTRAINT plw_secretary_demo_sessions_one_source CHECK (num_nonnulls(draft_id, kike_token) = 1);

CREATE INDEX IF NOT EXISTS plw_secretary_demo_sessions_kike_idx
  ON public.plw_secretary_demo_sessions (kike_token) WHERE kike_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_secretary_kike_demo_session(p_token text, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_used integer;
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('secretary-demo:' || p_token));
  SELECT count(*) INTO v_used FROM public.plw_secretary_demo_sessions WHERE kike_token = p_token;
  IF v_used >= p_limit THEN
    RETURN jsonb_build_object('allowed', false, 'used', v_used);
  END IF;
  INSERT INTO public.plw_secretary_demo_sessions (kike_token) VALUES (p_token) RETURNING id INTO v_id;
  RETURN jsonb_build_object('allowed', true, 'id', v_id, 'used', v_used + 1);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_secretary_kike_demo_session(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_secretary_kike_demo_session(text, integer) TO service_role;
