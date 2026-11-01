/*
# PLW Call Center core schema

1. Plain-English summary
- Creates the operational records for PLW Call Center: staff profiles, presence, prospects (one authoritative owner each), conversations, messages, drafts, private notes, follow-ups, notifications, activity events, sales materials, settings, and audit trails.
- Seeds three agent placeholders (Agente 1, 2, 3) and one administrator placeholder. All are disabled until their access is configured securely.

2. New tables
- staff_profiles: one row per agent or administrator. Holds display name, role, enabled flag, and workload limit.
- staff_presence: availability (Activo / Pausa), modeled operational state (in call / after call), and the last heartbeat.
- prospects: business inquiries and their single owner, sales stage, payment status (kept separate), next action, and follow-up time.
- conversations, messages, drafts: the inquiry thread. One draft per conversation.
- private_notes, followups, activity_events, notifications: operational history.
- assignment_queue, assignment_history, assignment_cursor: inquiry queue, ownership history, and round-robin rotation state.
- sales_materials: material metadata. Pricing stays awaiting administrator configuration.
- settings: operational values such as heartbeat timing and workload defaults.
- admin_audit_events: administrative actions.

3. Security
- RLS is enabled on every table.
- Agents read only prospects they own and records linked to them. Administrators read the full operation.
- Clients never write tables directly. Writes go through validated database functions that check ownership or administrator status.
- Helper functions resolve the caller's staff profile from the authenticated session. Client-supplied roles are never trusted.
- Credential and login-attempt tables are added in a later migration without any client grants.

4. Important notes
- Ownership is stored once, on prospects.owner_id. Conversation and reporting views derive it from there.
- Records marked is_test are excluded from production reporting by the application queries.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.staff_profiles (
  id text PRIMARY KEY CHECK (id ~ '^(agent|admin)-[0-9]+$'),
  role text NOT NULL CHECK (role IN ('agent', 'admin')),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 60),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  max_active_prospects integer CHECK (max_active_prospects IS NULL OR max_active_prospects >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_presence (
  staff_id text PRIMARY KEY REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  availability text NOT NULL DEFAULT 'paused' CHECK (availability IN ('active', 'paused')),
  operational text CHECK (operational IS NULL OR operational IN ('in_call', 'after_call')),
  last_heartbeat_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL CHECK (char_length(business_name) BETWEEN 1 AND 160),
  contact_name text NOT NULL DEFAULT '' CHECK (char_length(contact_name) <= 120),
  email text NOT NULL DEFAULT '' CHECK (char_length(email) <= 254),
  phone text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  business_category text NOT NULL DEFAULT '' CHECK (char_length(business_category) <= 120),
  service_interest text NOT NULL DEFAULT '' CHECK (char_length(service_interest) <= 160),
  source text NOT NULL DEFAULT 'manual' CHECK (char_length(source) <= 60),
  owner_id text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  stage text NOT NULL DEFAULT 'new' CHECK (stage IN (
    'new', 'contacted', 'demo_scheduled', 'proposal_sent', 'follow_up', 'won', 'lost'
  )),
  payment_status text NOT NULL DEFAULT 'not_recorded' CHECK (payment_status IN (
    'not_recorded', 'pending', 'paid'
  )),
  next_action text NOT NULL DEFAULT '' CHECK (char_length(next_action) <= 200),
  next_follow_up_at timestamptz,
  idempotency_key text UNIQUE,
  is_test boolean NOT NULL DEFAULT false,
  created_by text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospects_owner_idx ON public.prospects (owner_id, stage);

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL UNIQUE REFERENCES public.prospects(id) ON DELETE CASCADE,
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'waiting_agent' CHECK (status IN (
    'waiting_agent', 'waiting_customer', 'closed'
  )),
  unread boolean NOT NULL DEFAULT false,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_status_idx ON public.conversations (status, last_message_at);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  author text NOT NULL CHECK (author IN ('customer', 'agent')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  sent_by text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON public.messages (conversation_id, sent_at);

CREATE TABLE IF NOT EXISTS public.drafts (
  conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
  staff_id text NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.private_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS private_notes_prospect_idx ON public.private_notes (prospect_id, created_at);

CREATE TABLE IF NOT EXISTS public.followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('callback', 'email', 'meeting')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  due_at timestamptz NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS followups_agent_due_idx ON public.followups (agent_id, due_at);

CREATE TABLE IF NOT EXISTS public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('call', 'note', 'followup', 'message', 'stage_change', 'assignment')),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 300),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_agent_idx ON public.activity_events (agent_id, occurred_at);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id text NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('assignment')),
  body text NOT NULL CHECK (char_length(body) <= 300),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_staff_idx ON public.notifications (staff_id, read_at);

CREATE TABLE IF NOT EXISTS public.assignment_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL UNIQUE REFERENCES public.prospects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'assigned')),
  queued_at timestamptz NOT NULL DEFAULT now(),
  assigned_at timestamptz,
  assigned_to text REFERENCES public.staff_profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS assignment_queue_waiting_idx ON public.assignment_queue (status, queued_at, id);

CREATE TABLE IF NOT EXISTS public.assignment_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  from_owner_id text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  to_owner_id text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  mechanism text NOT NULL CHECK (mechanism IN ('round_robin', 'manual')),
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 300),
  actor_id text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assignment_history_prospect_idx ON public.assignment_history (prospect_id, created_at);

CREATE TABLE IF NOT EXISTS public.assignment_cursor (
  id integer PRIMARY KEY CHECK (id = 1),
  last_staff_id text REFERENCES public.staff_profiles(id) ON DELETE SET NULL
);
INSERT INTO public.assignment_cursor (id, last_staff_id) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sales_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 600),
  kind text NOT NULL CHECK (kind IN ('presentation', 'video', 'demonstration', 'email_template', 'pricing')),
  approval text NOT NULL DEFAULT 'awaiting_configuration' CHECK (approval IN ('approved', 'awaiting_configuration')),
  url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.settings (
  key text PRIMARY KEY CHECK (char_length(key) <= 80),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (char_length(action) <= 80),
  target_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.staff_profiles (id, role, display_name, is_enabled) VALUES
  ('agent-1', 'agent', 'Agente 1', false),
  ('agent-2', 'agent', 'Agente 2', false),
  ('agent-3', 'agent', 'Agente 3', false),
  ('admin-1', 'admin', 'Administrador', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.staff_presence (staff_id, availability)
SELECT id, 'paused' FROM public.staff_profiles
ON CONFLICT (staff_id) DO NOTHING;

INSERT INTO public.settings (key, value) VALUES
  ('presence_heartbeat_seconds', '30'::jsonb),
  ('presence_expiry_seconds', '90'::jsonb),
  ('default_max_active_prospects', '10'::jsonb),
  ('overdue_minutes', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.sales_materials (title, description, kind, approval) VALUES
  ('Presentación comercial PLW', 'Pendiente de cargar la presentación aprobada.', 'presentation', 'awaiting_configuration'),
  ('Video de servicios', 'Pendiente de enlace aprobado.', 'video', 'awaiting_configuration'),
  ('Demostración de la plataforma', 'Pendiente de enlace aprobado.', 'demonstration', 'awaiting_configuration'),
  ('Plantilla de primer contacto', 'Pendiente de aprobación por el administrador.', 'email_template', 'awaiting_configuration'),
  ('Precios y servicios', 'Pendiente de configuración por el administrador.', 'pricing', 'awaiting_configuration')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.current_staff_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id
  FROM public.staff_profiles s
  WHERE s.auth_user_id = auth.uid()
    AND s.is_enabled
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_profiles s
    WHERE s.auth_user_id = auth.uid()
      AND s.is_enabled
      AND s.role = 'admin'
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_prospect(p_prospect_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.prospects p
      WHERE p.id = p_prospect_id
        AND p.owner_id IS NOT NULL
        AND p.owner_id = public.current_staff_id()
    )
$$;

CREATE OR REPLACE FUNCTION public.can_access_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND public.can_access_prospect(c.prospect_id)
  )
$$;

REVOKE EXECUTE ON FUNCTION public.current_staff_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_prospect(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_staff_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_prospect(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_conversation(uuid) TO authenticated;

ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.staff_profiles TO authenticated;
GRANT SELECT ON public.staff_presence TO authenticated;
GRANT SELECT ON public.prospects TO authenticated;
GRANT SELECT ON public.conversations TO authenticated;
GRANT SELECT ON public.messages TO authenticated;
GRANT SELECT ON public.drafts TO authenticated;
GRANT SELECT ON public.private_notes TO authenticated;
GRANT SELECT ON public.followups TO authenticated;
GRANT SELECT ON public.activity_events TO authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT SELECT ON public.assignment_queue TO authenticated;
GRANT SELECT ON public.assignment_history TO authenticated;
GRANT SELECT ON public.sales_materials TO authenticated;
GRANT SELECT ON public.settings TO authenticated;
GRANT SELECT ON public.admin_audit_events TO authenticated;

DROP POLICY IF EXISTS "staff_profiles_select_self_or_admin" ON public.staff_profiles;
CREATE POLICY "staff_profiles_select_self_or_admin" ON public.staff_profiles
  FOR SELECT TO authenticated
  USING (id = public.current_staff_id() OR public.is_admin());

DROP POLICY IF EXISTS "staff_presence_select_self_or_admin" ON public.staff_presence;
CREATE POLICY "staff_presence_select_self_or_admin" ON public.staff_presence
  FOR SELECT TO authenticated
  USING (staff_id = public.current_staff_id() OR public.is_admin());

DROP POLICY IF EXISTS "prospects_select_owner_or_admin" ON public.prospects;
CREATE POLICY "prospects_select_owner_or_admin" ON public.prospects
  FOR SELECT TO authenticated
  USING (public.can_access_prospect(id));

DROP POLICY IF EXISTS "conversations_select_owner_or_admin" ON public.conversations;
CREATE POLICY "conversations_select_owner_or_admin" ON public.conversations
  FOR SELECT TO authenticated
  USING (public.can_access_prospect(prospect_id));

DROP POLICY IF EXISTS "messages_select_owner_or_admin" ON public.messages;
CREATE POLICY "messages_select_owner_or_admin" ON public.messages
  FOR SELECT TO authenticated
  USING (public.can_access_conversation(conversation_id));

DROP POLICY IF EXISTS "drafts_select_own" ON public.drafts;
CREATE POLICY "drafts_select_own" ON public.drafts
  FOR SELECT TO authenticated
  USING (staff_id = public.current_staff_id() AND public.can_access_conversation(conversation_id));

DROP POLICY IF EXISTS "private_notes_select_owner_or_admin" ON public.private_notes;
CREATE POLICY "private_notes_select_owner_or_admin" ON public.private_notes
  FOR SELECT TO authenticated
  USING (public.can_access_prospect(prospect_id));

DROP POLICY IF EXISTS "followups_select_owner_or_admin" ON public.followups;
CREATE POLICY "followups_select_owner_or_admin" ON public.followups
  FOR SELECT TO authenticated
  USING (agent_id = public.current_staff_id() OR public.is_admin());

DROP POLICY IF EXISTS "activity_select_own_or_admin" ON public.activity_events;
CREATE POLICY "activity_select_own_or_admin" ON public.activity_events
  FOR SELECT TO authenticated
  USING (agent_id = public.current_staff_id() OR public.is_admin());

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT TO authenticated
  USING (staff_id = public.current_staff_id());

DROP POLICY IF EXISTS "assignment_queue_select_admin" ON public.assignment_queue;
CREATE POLICY "assignment_queue_select_admin" ON public.assignment_queue
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "assignment_history_select_admin" ON public.assignment_history;
CREATE POLICY "assignment_history_select_admin" ON public.assignment_history
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "sales_materials_select_staff" ON public.sales_materials;
CREATE POLICY "sales_materials_select_staff" ON public.sales_materials
  FOR SELECT TO authenticated
  USING (public.current_staff_id() IS NOT NULL);

DROP POLICY IF EXISTS "settings_select_staff" ON public.settings;
CREATE POLICY "settings_select_staff" ON public.settings
  FOR SELECT TO authenticated
  USING (public.current_staff_id() IS NOT NULL);

DROP POLICY IF EXISTS "admin_audit_select_admin" ON public.admin_audit_events;
CREATE POLICY "admin_audit_select_admin" ON public.admin_audit_events
  FOR SELECT TO authenticated
  USING (public.is_admin());
