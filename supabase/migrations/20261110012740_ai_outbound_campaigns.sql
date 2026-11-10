/*
# AI outbound campaigns and lead lists

Adds the data foundation for an admin-run AI outbound dialer. Admins create a
campaign, upload a list of phone leads into it, and review the lists. This
migration does NOT place any calls: nothing in the database or the phone server
starts an outbound call from these tables yet.

1. New Tables
- `ai_outbound_campaigns`: one row per outbound campaign.
  - `id` (uuid, primary key)
  - `name` (text, required, 1-120 characters)
  - `purpose` (text, optional brief for the AI, up to 1000 characters)
  - `created_by` (uuid, the admin who created it, defaults to the signed-in user)
  - `created_at` (timestamptz)
- `ai_outbound_leads`: phone numbers belonging to a campaign.
  - `id` (uuid, primary key)
  - `campaign_id` (uuid, references the campaign; deleting a campaign deletes its leads)
  - `phone` (text, 8-digit Costa Rica number starting with 2-8)
  - `contact_name` and `business_name` (text, optional)
  - `created_at` (timestamptz)
  - One phone number can appear only once per campaign.

2. Security
- Row level security is enabled on both tables.
- Only signed-in administrators (`is_admin()`) can read, add, or delete rows.
- Agents and anonymous visitors get no access.
- Grants go to `authenticated` only, with SELECT, INSERT and DELETE. No UPDATE.

3. Important Notes
- Leads are not edited in place: to fix a number, delete the lead and add it again.
- Campaign status, call attempts and call outcomes are intentionally absent; they
  will be added with the dispatcher that actually places calls.
*/

CREATE TABLE IF NOT EXISTS ai_outbound_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  purpose text NOT NULL DEFAULT '' CHECK (char_length(purpose) <= 1000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_outbound_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES ai_outbound_campaigns(id) ON DELETE CASCADE,
  phone text NOT NULL CHECK (phone ~ '^[2-8][0-9]{7}$'),
  contact_name text NOT NULL DEFAULT '' CHECK (char_length(contact_name) <= 120),
  business_name text NOT NULL DEFAULT '' CHECK (char_length(business_name) <= 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, phone)
);

CREATE INDEX IF NOT EXISTS ai_outbound_leads_campaign_idx ON ai_outbound_leads (campaign_id);

ALTER TABLE ai_outbound_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_outbound_leads ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON ai_outbound_campaigns TO authenticated;
GRANT SELECT, INSERT, DELETE ON ai_outbound_leads TO authenticated;

DROP POLICY IF EXISTS "admin_select_ai_outbound_campaigns" ON ai_outbound_campaigns;
CREATE POLICY "admin_select_ai_outbound_campaigns" ON ai_outbound_campaigns FOR SELECT
TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "admin_insert_ai_outbound_campaigns" ON ai_outbound_campaigns;
CREATE POLICY "admin_insert_ai_outbound_campaigns" ON ai_outbound_campaigns FOR INSERT
TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS "admin_delete_ai_outbound_campaigns" ON ai_outbound_campaigns;
CREATE POLICY "admin_delete_ai_outbound_campaigns" ON ai_outbound_campaigns FOR DELETE
TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "admin_select_ai_outbound_leads" ON ai_outbound_leads;
CREATE POLICY "admin_select_ai_outbound_leads" ON ai_outbound_leads FOR SELECT
TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "admin_insert_ai_outbound_leads" ON ai_outbound_leads;
CREATE POLICY "admin_insert_ai_outbound_leads" ON ai_outbound_leads FOR INSERT
TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS "admin_delete_ai_outbound_leads" ON ai_outbound_leads;
CREATE POLICY "admin_delete_ai_outbound_leads" ON ai_outbound_leads FOR DELETE
TO authenticated USING (is_admin());
