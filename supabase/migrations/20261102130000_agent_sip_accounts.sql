/*
# Browser phone logins for agents

1. Plain-English summary
- Each agent gets one phone login for the Asterisk server: the server address, the SIP domain, the username and an encrypted password.
- The Vocex line password is not stored here or anywhere else in this database. It stays on the Asterisk server.

2. New objects
- agent_sip_accounts: one row per agent. The password is stored only as AES-GCM ciphertext. The key lives in the server secret SIP_CREDENTIAL_KEY.
- set_agent_sip_account: saves a login and writes the audit event in one transaction.

3. Security
- RLS is enabled with no policies, and browser roles have no access, so a password can only leave through the telephony function.
- That function gives agents only their own login, and gives administrators everything except the password.
- The audit event records who changed which login. It never includes the password.

4. Notes
- This project does not grant table access automatically, so service_role receives its grants here.
- Creating objects only. No existing data changes.
*/

CREATE TABLE IF NOT EXISTS public.agent_sip_accounts (
  staff_id text PRIMARY KEY REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  wss_url text NOT NULL,
  sip_domain text NOT NULL,
  sip_username text NOT NULL UNIQUE,
  password_ciphertext text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_sip_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agent_sip_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agent_sip_accounts TO service_role;

CREATE OR REPLACE FUNCTION public.set_agent_sip_account(
  p_actor_id text,
  p_staff_id text,
  p_wss_url text,
  p_sip_domain text,
  p_sip_username text,
  p_password_ciphertext text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles s
    WHERE s.id = p_staff_id AND s.role = 'agent'
  ) THEN
    RAISE EXCEPTION 'Solo los agentes pueden tener una cuenta de teléfono.';
  END IF;

  INSERT INTO public.agent_sip_accounts (staff_id, wss_url, sip_domain, sip_username, password_ciphertext)
  VALUES (p_staff_id, p_wss_url, p_sip_domain, p_sip_username, p_password_ciphertext)
  ON CONFLICT (staff_id) DO UPDATE
  SET wss_url = EXCLUDED.wss_url,
      sip_domain = EXCLUDED.sip_domain,
      sip_username = EXCLUDED.sip_username,
      password_ciphertext = EXCLUDED.password_ciphertext,
      updated_at = now();

  INSERT INTO public.admin_audit_events (actor_id, action, target_id, detail)
  VALUES (p_actor_id, 'sip_account.set', p_staff_id, jsonb_build_object('sip_username', p_sip_username));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_agent_sip_account(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_agent_sip_account(text, text, text, text, text, text) TO service_role;
