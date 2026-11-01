/*
# Google Workspace business mailbox connection

1. New Tables
- `google_oauth_states`: one-time authorization requests started by an administrator. Stores only a SHA-256 hash of the random state value, the administrator who started it, the expiry time, and when it was used.
- `google_workspace_connections`: one row per business mailbox. Stores the connection status, the verified Google account, and the refresh token encrypted with AES-GCM (ciphertext only, the key lives in server secrets).

2. Security
- Row level security is enabled on both tables with no policies.
- Neither table is granted to `anon` or `authenticated`. Only the `google-workspace` edge function (service role) reads or writes them, so refresh tokens never reach the browser.

3. Notes
- Creating the tables only; no existing data is changed.
- Statements are idempotent and safe to re-run.
*/

CREATE TABLE IF NOT EXISTS public.google_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  staff_id text NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS google_oauth_states_expires_at_idx
  ON public.google_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS public.google_workspace_connections (
  mailbox_address text PRIMARY KEY,
  status text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'connected', 'error')),
  connected_account text,
  refresh_token_ciphertext text,
  scopes text[] NOT NULL DEFAULT '{}',
  connected_by text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  connected_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_workspace_connections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.google_oauth_states FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.google_workspace_connections FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_oauth_states TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_workspace_connections TO service_role;
