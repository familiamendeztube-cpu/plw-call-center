/*
# AI outbound test calls and dialer settings

1. New Tables
- `ai_outbound_settings`: single row (id = 1) with the ElevenLabs test agent, the
  caller line used for outbound calls, and the voice used by the agent.
- `ai_outbound_test_calls`: one row per test call placed from the admin page.
  Holds the number, business name and type, the agent chosen for a transfer, and
  the ElevenLabs conversation ID once the call starts.

2. Security
- Row level security on both tables. Administrators can read them. Only the
  server (service role) writes them; browsers get no write grants.
- Phone numbers are limited to Costa Rica format to keep bad input out.
*/

CREATE TABLE IF NOT EXISTS ai_outbound_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  test_agent_id text NOT NULL CHECK (char_length(test_agent_id) BETWEEN 1 AND 120),
  caller_phone_number_id text NOT NULL CHECK (char_length(caller_phone_number_id) BETWEEN 1 AND 120),
  voice_id text NOT NULL CHECK (char_length(voice_id) BETWEEN 1 AND 120),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_outbound_test_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_phone text NOT NULL CHECK (to_phone ~ '^[2-8][0-9]{7}$'),
  business_name text NOT NULL CHECK (char_length(business_name) BETWEEN 1 AND 160),
  business_type text NOT NULL DEFAULT '' CHECK (char_length(business_type) <= 120),
  transfer_staff_id text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  conversation_id text CHECK (conversation_id IS NULL OR conversation_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  status text NOT NULL DEFAULT 'starting' CHECK (status IN ('starting', 'started', 'failed')),
  error text NOT NULL DEFAULT '' CHECK (char_length(error) <= 240),
  created_by text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_outbound_test_calls_created_idx ON ai_outbound_test_calls (created_at DESC);

ALTER TABLE ai_outbound_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_outbound_test_calls ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON ai_outbound_settings TO authenticated;
GRANT SELECT ON ai_outbound_test_calls TO authenticated;
GRANT SELECT, INSERT, UPDATE ON ai_outbound_settings TO service_role;
GRANT SELECT, INSERT, UPDATE ON ai_outbound_test_calls TO service_role;

DROP POLICY IF EXISTS "admin_select_ai_outbound_settings" ON ai_outbound_settings;
CREATE POLICY "admin_select_ai_outbound_settings" ON ai_outbound_settings FOR SELECT
TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "admin_select_ai_outbound_test_calls" ON ai_outbound_test_calls;
CREATE POLICY "admin_select_ai_outbound_test_calls" ON ai_outbound_test_calls FOR SELECT
TO authenticated USING (is_admin());
