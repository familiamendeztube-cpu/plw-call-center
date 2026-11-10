/*
# AI outbound: business type, do-not-call list, campaign agents

Extends the outbound lead intake so admins can import richer lead files, keep a
do-not-call list, and choose which agents take part in a campaign. Still no
calls are placed by anything in this migration.

1. Modified Tables
- `ai_outbound_leads` gets `business_type` (text, optional, up to 120 characters).

2. New Tables
- `ai_outbound_do_not_call`: phone numbers that must never be called.
  - `phone` (text, primary key, 8-digit Costa Rica number)
  - `reason` (text, optional, up to 240 characters)
  - `created_at` (timestamptz)
- `ai_outbound_campaign_agents`: agents selected to take part in a campaign.
  - `campaign_id` (uuid, references the campaign; deleting a campaign removes its rows)
  - `staff_id` (text, references the staff profile of an agent)
  - Primary key is (campaign_id, staff_id).

3. Security
- Row level security is enabled on both new tables.
- Only administrators (`is_admin()`) can read, add, or remove rows.
- Grants go to `authenticated` only. No anonymous access and no UPDATE grants.

4. Important Notes
- Adding a number to the do-not-call list does not delete existing leads by itself;
  the admin page removes them in the same action.
- Campaign agents are a selection only; they do not start or route calls yet.
*/

ALTER TABLE ai_outbound_leads
  ADD COLUMN IF NOT EXISTS business_type text NOT NULL DEFAULT ''
  CHECK (char_length(business_type) <= 120);

CREATE TABLE IF NOT EXISTS ai_outbound_do_not_call (
  phone text PRIMARY KEY CHECK (phone ~ '^[2-8][0-9]{7}$'),
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 240),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_outbound_campaign_agents (
  campaign_id uuid NOT NULL REFERENCES ai_outbound_campaigns(id) ON DELETE CASCADE,
  staff_id text NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, staff_id)
);

ALTER TABLE ai_outbound_do_not_call ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_outbound_campaign_agents ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON ai_outbound_do_not_call TO authenticated;
GRANT SELECT, INSERT, DELETE ON ai_outbound_campaign_agents TO authenticated;

DROP POLICY IF EXISTS "admin_select_ai_outbound_do_not_call" ON ai_outbound_do_not_call;
CREATE POLICY "admin_select_ai_outbound_do_not_call" ON ai_outbound_do_not_call FOR SELECT
TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "admin_insert_ai_outbound_do_not_call" ON ai_outbound_do_not_call;
CREATE POLICY "admin_insert_ai_outbound_do_not_call" ON ai_outbound_do_not_call FOR INSERT
TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS "admin_delete_ai_outbound_do_not_call" ON ai_outbound_do_not_call;
CREATE POLICY "admin_delete_ai_outbound_do_not_call" ON ai_outbound_do_not_call FOR DELETE
TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "admin_select_ai_outbound_campaign_agents" ON ai_outbound_campaign_agents;
CREATE POLICY "admin_select_ai_outbound_campaign_agents" ON ai_outbound_campaign_agents FOR SELECT
TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "admin_insert_ai_outbound_campaign_agents" ON ai_outbound_campaign_agents;
CREATE POLICY "admin_insert_ai_outbound_campaign_agents" ON ai_outbound_campaign_agents FOR INSERT
TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS "admin_delete_ai_outbound_campaign_agents" ON ai_outbound_campaign_agents;
CREATE POLICY "admin_delete_ai_outbound_campaign_agents" ON ai_outbound_campaign_agents FOR DELETE
TO authenticated USING (is_admin());
