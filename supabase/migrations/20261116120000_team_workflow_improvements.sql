/*
# Team workflow improvements (2026-11-16)

1. Plain-English summary
- A customer's "next follow-up" now follows their follow-ups: the earliest one not done yet. Nothing
  ever filled it in before, so it always read "Sin agendar".
- Agents can move a follow-up to another time and add a customer of their own (a walk-in or a
  referral). A number or email that already belongs to another agent's customer is refused.
- The phone tells the server while an agent is on a call. The administrator sees "En llamada", and
  Anna's dialer, which already skips agents whose presence says so, stops calling for a busy agent.
- Administrators can add agents and manage sales materials from the app.
- Every start, pause or stop of an Anna dialer is recorded with who did it ("Sistema" when the
  dialer itself changed state).
- Email replies waiting in the outbox are sent every minute, but only once Google is connected.
  email_sending_ready() lets the app tell agents when it is not.

2. New objects
- Trigger followups_next_follow_up (sync_next_follow_up): keeps prospects.next_follow_up_at.
- reschedule_followup(followup, due_at): the follow-up's agent or an administrator.
- set_operational_status(status): 'in_call' or NULL, on the signed-in staff member's own presence.
- agent_create_prospect(...): a customer owned by the agent who adds it, never round-robin.
- admin_create_agent(name): the next agent-N, disabled until it has a PIN and is enabled.
- admin_save_material(...), admin_delete_material(id): links must start with https://.
- Trigger dental_dialer_state_audit (audit_dental_dialer_state) into admin_audit_events.
- gmail_outbox_tick() with cron job 'gmail-outbox-tick', and email_sending_ready().

3. Security
- Browser functions check the caller inside, like the existing ones. Trigger and scheduler functions
  cannot be called by browsers. No table grants change.
*/

-- Next follow-up -------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_next_follow_up()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prospect uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.prospect_id ELSE NEW.prospect_id END;
BEGIN
  UPDATE public.prospects p
  SET next_follow_up_at = (
    SELECT min(f.due_at) FROM public.followups f
    WHERE f.prospect_id = v_prospect AND NOT f.completed
  )
  WHERE p.id = v_prospect;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS followups_next_follow_up ON public.followups;
CREATE TRIGGER followups_next_follow_up
AFTER INSERT OR DELETE OR UPDATE OF due_at, completed ON public.followups
FOR EACH ROW EXECUTE FUNCTION public.sync_next_follow_up();

UPDATE public.prospects p
SET next_follow_up_at = pending.due_at
FROM (
  SELECT f.prospect_id, min(f.due_at) AS due_at
  FROM public.followups f WHERE NOT f.completed GROUP BY f.prospect_id
) pending
WHERE pending.prospect_id = p.id;

CREATE OR REPLACE FUNCTION public.reschedule_followup(p_followup_id uuid, p_due_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_agent text;
  v_prospect uuid;
BEGIN
  SELECT f.agent_id, f.prospect_id INTO v_agent, v_prospect
  FROM public.followups f WHERE f.id = p_followup_id;
  IF v_agent IS NULL OR NOT (v_agent = public.current_staff_id() OR public.is_admin()) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF p_due_at IS NULL THEN
    RAISE EXCEPTION 'Indique la nueva fecha del seguimiento.';
  END IF;

  UPDATE public.followups SET due_at = p_due_at, completed = false WHERE id = p_followup_id;
  INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
  VALUES (v_agent, v_prospect, 'followup', 'Seguimiento reprogramado');
END;
$$;

-- On a call ------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_operational_status(p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me text := public.current_staff_id();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida.' USING ERRCODE = '42501';
  END IF;
  -- Only the live call is shared. 'after_call' stays in the browser: a call screen left open
  -- would otherwise keep Anna's dialer from calling for this agent.
  IF p_status IS NOT NULL AND p_status <> 'in_call' THEN
    RAISE EXCEPTION 'Estado no válido.';
  END IF;
  UPDATE public.staff_presence SET operational = p_status, updated_at = now() WHERE staff_id = v_me;
END;
$$;

-- An agent's own customer ------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.agent_create_prospect(
  p_business_name text,
  p_contact_name text,
  p_email text,
  p_phone text,
  p_business_category text,
  p_service_interest text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me text := public.current_staff_id();
  v_name text := btrim(COALESCE(p_business_name, ''));
  v_phone text := btrim(COALESCE(p_phone, ''));
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_digits text := right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 8);
  v_existing uuid;
  v_owner text;
  v_prospect uuid;
BEGIN
  IF v_me IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles s WHERE s.id = v_me AND s.role = 'agent'
  ) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'Escriba el nombre del negocio (hasta 160 caracteres).';
  END IF;
  IF v_phone = '' AND v_email = '' THEN
    RAISE EXCEPTION 'Agregue un teléfono o un correo.';
  END IF;
  IF v_phone <> '' AND (char_length(v_digits) < 8 OR char_length(v_phone) > 40) THEN
    RAISE EXCEPTION 'El teléfono debe tener al menos 8 dígitos.';
  END IF;
  IF v_email <> '' AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR char_length(v_email) > 254) THEN
    RAISE EXCEPTION 'El correo no es válido.';
  END IF;

  -- Two adds of one number or email at the same moment cannot create two customers.
  PERFORM pg_advisory_xact_lock(1113, hashtext(COALESCE(NULLIF(v_digits, ''), v_email)));

  -- ponytail: same last-8-digit match as start_whatsapp_customer; an own customer wins.
  SELECT p.id, p.owner_id INTO v_existing, v_owner
  FROM public.prospects p
  WHERE NOT p.is_test AND (
    (v_digits <> '' AND right(regexp_replace(p.phone, '\D', '', 'g'), 8) = v_digits)
    OR (v_email <> '' AND lower(p.email) = v_email)
  )
  ORDER BY (p.owner_id = v_me) DESC NULLS LAST, p.created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    IF v_owner = v_me THEN
      RETURN v_existing;
    END IF;
    RAISE EXCEPTION 'Ese teléfono o correo ya pertenece a otro cliente. Pídale al administrador que se lo asigne.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.prospects (
    business_name, contact_name, email, phone, business_category, service_interest,
    source, owner_id, stage, created_by
  ) VALUES (
    v_name,
    left(btrim(COALESCE(p_contact_name, '')), 120),
    v_email,
    v_phone,
    left(btrim(COALESCE(p_business_category, '')), 120),
    left(btrim(COALESCE(p_service_interest, '')), 160),
    'manual', v_me, 'new', v_me
  )
  RETURNING id INTO v_prospect;

  INSERT INTO public.conversations (prospect_id, subject, status)
  VALUES (v_prospect, v_name, 'waiting_customer');
  -- Assigned by the agent's own action, not by round-robin.
  INSERT INTO public.assignment_queue (prospect_id, status, assigned_at, assigned_to)
  VALUES (v_prospect, 'assigned', now(), v_me);
  INSERT INTO public.assignment_history (prospect_id, to_owner_id, mechanism, reason, actor_id)
  VALUES (v_prospect, v_me, 'manual', 'El agente agregó el cliente', v_me);
  INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
  VALUES (v_me, v_prospect, 'assignment', 'Agregó el cliente ' || v_name);

  RETURN v_prospect;
END;
$$;

-- Agents ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_create_agent(p_display_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := public.current_staff_id();
  v_name text := btrim(COALESCE(p_display_name, ''));
  v_id text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'El nombre debe tener entre 1 y 60 caracteres.';
  END IF;

  PERFORM pg_advisory_xact_lock(1114, 0);
  SELECT 'agent-' || (COALESCE(max(substring(s.id FROM 7)::integer), 0) + 1) INTO v_id
  FROM public.staff_profiles s WHERE s.role = 'agent';

  -- Disabled until the administrator gives it a PIN and enables it, like the first three.
  INSERT INTO public.staff_profiles (id, role, display_name, is_enabled)
  VALUES (v_id, 'agent', v_name, false);
  INSERT INTO public.staff_presence (staff_id, availability)
  VALUES (v_id, 'paused') ON CONFLICT (staff_id) DO NOTHING;
  INSERT INTO public.admin_audit_events (actor_id, action, target_id, detail)
  VALUES (v_actor, 'staff.create', v_id, jsonb_build_object('display_name', v_name));
  RETURN v_id;
END;
$$;

-- Sales materials ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_save_material(
  p_id uuid,
  p_title text,
  p_description text,
  p_kind text,
  p_url text,
  p_approved boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := public.current_staff_id();
  v_title text := btrim(COALESCE(p_title, ''));
  v_description text := btrim(COALESCE(p_description, ''));
  v_url text := NULLIF(btrim(COALESCE(p_url, '')), '');
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_title) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'El título debe tener entre 1 y 160 caracteres.';
  END IF;
  IF char_length(v_description) > 600 THEN
    RAISE EXCEPTION 'La descripción puede tener hasta 600 caracteres.';
  END IF;
  IF p_kind NOT IN ('presentation', 'video', 'demonstration', 'email_template', 'pricing') THEN
    RAISE EXCEPTION 'Tipo de material no válido.';
  END IF;
  -- Agents open and send these links: only web addresses, never javascript: or data: links.
  IF v_url IS NOT NULL AND (v_url !~ '^https://[^\s]+$' OR char_length(v_url) > 2000) THEN
    RAISE EXCEPTION 'El enlace debe empezar con https://.';
  END IF;
  IF COALESCE(p_approved, false) AND v_url IS NULL THEN
    RAISE EXCEPTION 'Un material aprobado necesita un enlace.';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.sales_materials (title, description, kind, approval, url)
    VALUES (v_title, v_description, p_kind,
            CASE WHEN p_approved THEN 'approved' ELSE 'awaiting_configuration' END, v_url)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.sales_materials
    SET title = v_title, description = v_description, kind = p_kind, url = v_url,
        approval = CASE WHEN p_approved THEN 'approved' ELSE 'awaiting_configuration' END,
        updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'El material ya no existe.';
    END IF;
  END IF;

  INSERT INTO public.admin_audit_events (actor_id, action, target_id, detail)
  VALUES (v_actor, 'material.save', v_id::text, jsonb_build_object('title', v_title));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_material(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := public.current_staff_id();
  v_title text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.sales_materials WHERE id = p_id RETURNING title INTO v_title;
  IF v_title IS NOT NULL THEN
    INSERT INTO public.admin_audit_events (actor_id, action, target_id, detail)
    VALUES (v_actor, 'material.delete', p_id::text, jsonb_build_object('title', v_title));
  END IF;
END;
$$;

-- Who started or stopped Anna --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_dental_dialer_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- current_staff_id() is the person who pressed the button; NULL when the dialer itself changed
  -- state (the scheduler runs without a staff session).
  INSERT INTO public.admin_audit_events (actor_id, action, target_id, detail)
  VALUES (
    public.current_staff_id(),
    'dental_dialer.' || NEW.state,
    NEW.staff_id,
    jsonb_strip_nulls(jsonb_build_object('from', OLD.state, 'error', NULLIF(NEW.last_error, '')))
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS dental_dialer_state_audit ON public.dental_agent_dialers;
CREATE TRIGGER dental_dialer_state_audit
AFTER UPDATE OF state ON public.dental_agent_dialers
FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
EXECUTE FUNCTION public.audit_dental_dialer_state();

-- Email outbox ---------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.email_sending_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.current_staff_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.google_workspace_connections c
    WHERE c.status = 'connected' AND c.refresh_token_ciphertext IS NOT NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.gmail_outbox_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token text;
  v_request bigint;
BEGIN
  -- No request while there is nothing to send or no Google account to send it with.
  IF NOT EXISTS (
    SELECT 1 FROM public.gmail_outbox o WHERE o.status IN ('queued', 'sending', 'confirming')
  ) OR NOT EXISTS (
    SELECT 1 FROM public.google_workspace_connections c
    WHERE c.status = 'connected' AND c.refresh_token_ciphertext IS NOT NULL
  ) THEN
    RETURN NULL;
  END IF;

  SELECT s.decrypted_secret INTO v_token
  FROM vault.decrypted_secrets s
  WHERE s.name = 'gmail_sync_scheduler_secret';
  IF v_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://meagbbmittuhdgwnhvxa.supabase.co/functions/v1/google-workspace/outbox/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_request;

  RETURN v_request;
END;
$$;

DO $$
BEGIN
  PERFORM cron.schedule('gmail-outbox-tick', '* * * * *', 'select public.gmail_outbox_tick()');
END $$;

-- Grants ---------------------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.sync_next_follow_up() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_dental_dialer_state() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gmail_outbox_tick() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.reschedule_followup(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_operational_status(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.agent_create_prospect(text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_create_agent(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_save_material(uuid, text, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_material(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.email_sending_ready() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.reschedule_followup(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_operational_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_create_prospect(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_agent(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_material(uuid, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_material(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.email_sending_ready() TO authenticated;
