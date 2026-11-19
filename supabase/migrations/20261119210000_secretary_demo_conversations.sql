/*
# Secretaria IA demo: live ElevenLabs conversations, 3 per customer

The demo page talks to a real ElevenLabs agent that answers from the business's saved
draft. Each conversation needs a token that only the plw-secretary-converse function hands
out (the agent has enable_auth on), and the function hands out at most 3 per draft. Each
conversation is capped by the agent itself (10 questions in the prompt, 5 minutes hard limit
in max_duration_seconds), so one customer can use at most ~15 billed minutes.

1. plw_secretary_demo_sessions: one row per token handed out (draft, ElevenLabs
   conversation id). Server-only: no browser access.
2. claim_secretary_demo_session(draft, limit): counts and inserts under a per-draft lock, so
   two tabs starting at the same moment cannot get a fourth conversation. service_role only.
3. The shared demo agent's id and config version live in settings under
   'secretary_demo_agent'; the function grants service_role the access it needs there.
*/

CREATE TABLE IF NOT EXISTS public.plw_secretary_demo_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.prospect_site_drafts(id) ON DELETE CASCADE,
  conversation_id text CHECK (conversation_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plw_secretary_demo_sessions_draft_idx
  ON public.plw_secretary_demo_sessions (draft_id);

ALTER TABLE public.plw_secretary_demo_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plw_secretary_demo_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plw_secretary_demo_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.settings TO service_role;

CREATE OR REPLACE FUNCTION public.claim_secretary_demo_session(p_draft_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_used integer;
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('secretary-demo:' || p_draft_id::text));
  SELECT count(*) INTO v_used FROM public.plw_secretary_demo_sessions WHERE draft_id = p_draft_id;
  IF v_used >= p_limit THEN
    RETURN jsonb_build_object('allowed', false, 'used', v_used);
  END IF;
  INSERT INTO public.plw_secretary_demo_sessions (draft_id) VALUES (p_draft_id) RETURNING id INTO v_id;
  RETURN jsonb_build_object('allowed', true, 'id', v_id, 'used', v_used + 1);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_secretary_demo_session(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_secretary_demo_session(uuid, integer) TO service_role;
