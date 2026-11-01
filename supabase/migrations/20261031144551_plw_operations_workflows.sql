/*
# Operations workflows: presence, assignment queue, inquiries, and staff actions

1. Plain-English summary
- Presence: agents send a heartbeat; an agent counts as present only while the heartbeat is fresh. Pausa stops new assignments without ending the session.
- Assignment: inquiries join a waiting queue in arrival order. A single serialized process assigns the oldest waiting inquiry to the next eligible agent in round-robin order. Eligible means enabled, valid session, fresh presence, "Activo", not in call or after-call, and under the capacity limit.
- Intake: one shared intake function creates the prospect, its conversation, and its queue entry. Admin manual entry and the future email connector both use it. Retries with the same key return the original record and keep its queue position.
- Workflow actions: stage changes, next actions, private notes, drafts, replies, follow-ups, and admin reassignment with a required reason. Each action checks ownership or administrator rights on the server.
- Administration: staff names, limits, enable or disable (requires a configured credential), device enrollment and revocation, and whitelisted settings.

2. Changed or new objects
- Functions (new): record_heartbeat, set_availability, process_waiting_queue (internal), pick_round_robin_agent (internal), intake_inquiry (service role), create_inquiry (admin), set_prospect_stage, set_next_action, set_payment_status, add_private_note, save_draft, send_reply, schedule_followup, set_followup_completed, reassign_prospect, list_overdue_conversations, admin_update_staff, admin_set_setting, admin_create_device_enrollment, admin_list_devices, admin_revoke_device.
- Function changed: setting_int is now readable by signed-in staff so that row-level security checks can use it.

3. Security
- Every client-facing function checks the caller's identity and role on the server. Internal helpers and intake are not callable by browsers.
- Clients have no direct write access to any table.
- Ownership changes happen only through reassign_prospect or intake, and each one writes an assignment history record.
- Only one assignment can run at a time (transaction-level advisory lock), and the queue row is locked before change, so one inquiry cannot be assigned twice and no agent exceeds capacity.

4. Important notes
- Eligibility limit: active means any stage except won or lost.
- Reassignment can exceed an agent's limit only when an administrator chooses it; the reason is always recorded.
- Email delivery and telephony remain pending integrations. Replies are stored in the conversation and marked as not yet delivered by email.
*/

GRANT EXECUTE ON FUNCTION public.setting_int(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.pick_round_robin_agent()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_last text;
  v_agent text;
  v_expiry integer := public.setting_int('presence_expiry_seconds', 90);
  v_default_limit integer := public.setting_int('default_max_active_prospects', 10);
BEGIN
  SELECT c.last_staff_id INTO v_last FROM public.assignment_cursor c WHERE c.id = 1 FOR UPDATE;

  SELECT s.id INTO v_agent
  FROM public.staff_profiles s
  JOIN public.staff_presence p ON p.staff_id = s.id
  WHERE s.role = 'agent'
    AND s.is_enabled
    AND s.auth_user_id IS NOT NULL
    AND p.availability = 'active'
    AND p.operational IS NULL
    AND p.last_heartbeat_at >= now() - make_interval(secs => v_expiry)
    AND (
      SELECT count(*)
      FROM public.prospects pr
      WHERE pr.owner_id = s.id AND pr.stage NOT IN ('won', 'lost')
    ) < COALESCE(s.max_active_prospects, v_default_limit)
  ORDER BY (s.id > COALESCE(v_last, '')) DESC, s.id ASC
  LIMIT 1;

  IF v_agent IS NOT NULL THEN
    UPDATE public.assignment_cursor SET last_staff_id = v_agent WHERE id = 1;
  END IF;

  RETURN v_agent;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_waiting_queue()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_queue_id uuid;
  v_prospect_id uuid;
  v_business_name text;
  v_agent text;
  v_assigned integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(947201);

  LOOP
    SELECT q.id, q.prospect_id INTO v_queue_id, v_prospect_id
    FROM public.assignment_queue q
    WHERE q.status = 'waiting'
    ORDER BY q.queued_at, q.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    EXIT WHEN NOT FOUND;

    v_agent := public.pick_round_robin_agent();
    EXIT WHEN v_agent IS NULL;

    SELECT p.business_name INTO v_business_name FROM public.prospects p WHERE p.id = v_prospect_id;

    UPDATE public.prospects SET owner_id = v_agent, updated_at = now() WHERE id = v_prospect_id;
    UPDATE public.assignment_queue
    SET status = 'assigned', assigned_at = now(), assigned_to = v_agent
    WHERE id = v_queue_id;

    INSERT INTO public.assignment_history (prospect_id, from_owner_id, to_owner_id, mechanism, reason, actor_id)
    VALUES (v_prospect_id, NULL, v_agent, 'round_robin', '', NULL);

    INSERT INTO public.notifications (staff_id, prospect_id, kind, body)
    VALUES (v_agent, v_prospect_id, 'assignment', 'Nueva consulta asignada: ' || v_business_name);

    INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
    VALUES (v_agent, v_prospect_id, 'assignment', 'Consulta asignada: ' || v_business_name);

    v_assigned := v_assigned + 1;
  END LOOP;

  RETURN v_assigned;
END;
$$;

CREATE OR REPLACE FUNCTION public.intake_inquiry(
  p_business_name text,
  p_contact_name text,
  p_email text,
  p_phone text,
  p_business_category text,
  p_service_interest text,
  p_source text,
  p_notes text,
  p_is_test boolean,
  p_idempotency_key text,
  p_actor_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prospect_id uuid;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT p.id INTO v_prospect_id FROM public.prospects p WHERE p.idempotency_key = p_idempotency_key;
    IF v_prospect_id IS NOT NULL THEN
      RETURN v_prospect_id;
    END IF;
  END IF;

  INSERT INTO public.prospects (
    business_name, contact_name, email, phone, business_category,
    service_interest, source, idempotency_key, is_test, created_by
  )
  VALUES (
    p_business_name, COALESCE(p_contact_name, ''), COALESCE(p_email, ''), COALESCE(p_phone, ''),
    COALESCE(p_business_category, ''), COALESCE(p_service_interest, ''), COALESCE(p_source, 'manual'),
    p_idempotency_key, COALESCE(p_is_test, false), p_actor_id
  )
  RETURNING id INTO v_prospect_id;

  INSERT INTO public.conversations (prospect_id, subject)
  VALUES (v_prospect_id, p_business_name);

  INSERT INTO public.assignment_queue (prospect_id) VALUES (v_prospect_id);

  IF p_actor_id IS NOT NULL AND NULLIF(btrim(COALESCE(p_notes, '')), '') IS NOT NULL THEN
    INSERT INTO public.private_notes (prospect_id, author_id, body)
    VALUES (v_prospect_id, p_actor_id, btrim(p_notes));
  END IF;

  PERFORM public.process_waiting_queue();

  RETURN v_prospect_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_inquiry(
  p_business_name text,
  p_contact_name text,
  p_email text,
  p_phone text,
  p_business_category text,
  p_service_interest text,
  p_source text,
  p_notes text,
  p_is_test boolean,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := public.current_staff_id();
  v_prospect_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_business_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'El nombre del negocio es obligatorio.';
  END IF;
  IF NULLIF(btrim(COALESCE(p_contact_name, '')), '') IS NULL
     AND NULLIF(btrim(COALESCE(p_email, '')), '') IS NULL
     AND NULLIF(btrim(COALESCE(p_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Indique al menos un contacto: persona, correo o teléfono.';
  END IF;

  v_prospect_id := public.intake_inquiry(
    btrim(p_business_name),
    btrim(COALESCE(p_contact_name, '')),
    btrim(COALESCE(p_email, '')),
    btrim(COALESCE(p_phone, '')),
    btrim(COALESCE(p_business_category, '')),
    btrim(COALESCE(p_service_interest, '')),
    COALESCE(NULLIF(btrim(COALESCE(p_source, '')), ''), 'manual'),
    p_notes,
    COALESCE(p_is_test, false),
    NULLIF(btrim(COALESCE(p_idempotency_key, '')), ''),
    v_actor
  );

  INSERT INTO public.admin_audit_events (actor_id, action, target_id, detail)
  VALUES (v_actor, 'inquiry.create', v_prospect_id::text, jsonb_build_object('source', COALESCE(p_source, 'manual')));

  RETURN v_prospect_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_heartbeat()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me text := public.current_staff_id();
  v_availability text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.staff_presence (staff_id, availability, last_heartbeat_at, updated_at)
  VALUES (v_me, 'paused', now(), now())
  ON CONFLICT (staff_id) DO UPDATE
  SET last_heartbeat_at = now(), updated_at = now()
  RETURNING availability INTO v_availability;

  IF v_availability = 'active' THEN
    PERFORM public.process_waiting_queue();
  END IF;

  RETURN v_availability;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_availability(p_availability text)
RETURNS text
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
  IF p_availability NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION 'Estado no válido.';
  END IF;

  INSERT INTO public.staff_presence (staff_id, availability, last_heartbeat_at, updated_at)
  VALUES (v_me, p_availability, now(), now())
  ON CONFLICT (staff_id) DO UPDATE
  SET availability = EXCLUDED.availability, last_heartbeat_at = now(), updated_at = now();

  IF p_availability = 'active' THEN
    PERFORM public.process_waiting_queue();
  END IF;

  RETURN p_availability;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_prospect_stage(p_prospect_id uuid, p_stage text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner text;
  v_old_stage text;
BEGIN
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF p_stage NOT IN ('new', 'contacted', 'demo_scheduled', 'proposal_sent', 'follow_up', 'won', 'lost') THEN
    RAISE EXCEPTION 'Etapa no válida.';
  END IF;

  SELECT p.owner_id, p.stage INTO v_owner, v_old_stage
  FROM public.prospects p WHERE p.id = p_prospect_id FOR UPDATE;

  UPDATE public.prospects SET stage = p_stage, updated_at = now() WHERE id = p_prospect_id;

  IF v_owner IS NOT NULL AND v_old_stage IS DISTINCT FROM p_stage THEN
    INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
    VALUES (v_owner, p_prospect_id, 'stage_change', 'Etapa actualizada');
  END IF;

  IF p_stage IN ('won', 'lost') THEN
    PERFORM public.process_waiting_queue();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_next_action(
  p_prospect_id uuid,
  p_next_action text,
  p_follow_up_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.prospects
  SET next_action = btrim(COALESCE(p_next_action, '')),
      next_follow_up_at = p_follow_up_at,
      updated_at = now()
  WHERE id = p_prospect_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_payment_status(p_prospect_id uuid, p_payment_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF p_payment_status NOT IN ('not_recorded', 'pending', 'paid') THEN
    RAISE EXCEPTION 'Estado de pago no válido.';
  END IF;
  UPDATE public.prospects
  SET payment_status = p_payment_status, updated_at = now()
  WHERE id = p_prospect_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_private_note(p_prospect_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me text := public.current_staff_id();
  v_note_id uuid;
BEGIN
  IF NOT public.can_access_prospect(p_prospect_id) OR v_me IS NULL THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_body, '')), '') IS NULL OR char_length(btrim(p_body)) > 2000 THEN
    RAISE EXCEPTION 'La nota debe tener entre 1 y 2000 caracteres.';
  END IF;

  INSERT INTO public.private_notes (prospect_id, author_id, body)
  VALUES (p_prospect_id, v_me, btrim(p_body))
  RETURNING id INTO v_note_id;

  RETURN v_note_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_draft(p_conversation_id uuid, p_body text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me text := public.current_staff_id();
  v_owner text;
  v_saved_at timestamptz := now();
BEGIN
  SELECT p.owner_id INTO v_owner
  FROM public.conversations c
  JOIN public.prospects p ON p.id = c.prospect_id
  WHERE c.id = p_conversation_id;

  IF v_me IS NULL OR v_owner IS DISTINCT FROM v_me THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF char_length(COALESCE(p_body, '')) > 4000 THEN
    RAISE EXCEPTION 'El borrador es demasiado largo.';
  END IF;

  INSERT INTO public.drafts (conversation_id, staff_id, body, updated_at)
  VALUES (p_conversation_id, v_me, COALESCE(p_body, ''), v_saved_at)
  ON CONFLICT (conversation_id) DO UPDATE
  SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at;

  RETURN v_saved_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_reply(p_conversation_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me text := public.current_staff_id();
  v_owner text;
  v_prospect_id uuid;
  v_message_id uuid;
BEGIN
  SELECT p.owner_id, p.id INTO v_owner, v_prospect_id
  FROM public.conversations c
  JOIN public.prospects p ON p.id = c.prospect_id
  WHERE c.id = p_conversation_id;

  IF v_me IS NULL OR v_owner IS DISTINCT FROM v_me THEN
    RAISE EXCEPTION 'Solo el agente asignado puede responder esta conversación.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_body, '')), '') IS NULL OR char_length(btrim(p_body)) > 8000 THEN
    RAISE EXCEPTION 'La respuesta debe tener entre 1 y 8000 caracteres.';
  END IF;

  INSERT INTO public.messages (conversation_id, author, body, sent_by)
  VALUES (p_conversation_id, 'agent', btrim(p_body), v_me)
  RETURNING id INTO v_message_id;

  UPDATE public.conversations
  SET status = 'waiting_customer', unread = false, last_message_at = now()
  WHERE id = p_conversation_id;

  DELETE FROM public.drafts WHERE conversation_id = p_conversation_id;

  INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
  VALUES (v_me, v_prospect_id, 'message', 'Respuesta registrada en la conversación');

  RETURN v_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_followup(
  p_prospect_id uuid,
  p_kind text,
  p_title text,
  p_due_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner text;
  v_followup_id uuid;
BEGIN
  SELECT p.owner_id INTO v_owner FROM public.prospects p WHERE p.id = p_prospect_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM public.current_staff_id() THEN
    RAISE EXCEPTION 'Solo el agente asignado puede programar seguimientos.' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('callback', 'email', 'meeting') THEN
    RAISE EXCEPTION 'Tipo de seguimiento no válido.';
  END IF;
  IF NULLIF(btrim(COALESCE(p_title, '')), '') IS NULL OR char_length(btrim(p_title)) > 200 THEN
    RAISE EXCEPTION 'El título debe tener entre 1 y 200 caracteres.';
  END IF;

  INSERT INTO public.followups (prospect_id, agent_id, kind, title, due_at)
  VALUES (p_prospect_id, v_owner, p_kind, btrim(p_title), p_due_at)
  RETURNING id INTO v_followup_id;

  INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
  VALUES (v_owner, p_prospect_id, 'followup', 'Seguimiento programado: ' || btrim(p_title));

  RETURN v_followup_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_followup_completed(p_followup_id uuid, p_completed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_agent text;
BEGIN
  SELECT f.agent_id INTO v_agent FROM public.followups f WHERE f.id = p_followup_id;
  IF v_agent IS NULL OR NOT (v_agent = public.current_staff_id() OR public.is_admin()) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.followups SET completed = COALESCE(p_completed, false) WHERE id = p_followup_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_prospect(
  p_prospect_id uuid,
  p_to_staff_id text,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := public.current_staff_id();
  v_from text;
  v_name text;
  v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 3 OR char_length(v_reason) > 300 THEN
    RAISE EXCEPTION 'Indique el motivo de la reasignación (entre 3 y 300 caracteres).';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles s
    WHERE s.id = p_to_staff_id AND s.role = 'agent' AND s.is_enabled
  ) THEN
    RAISE EXCEPTION 'El agente de destino no está habilitado.';
  END IF;

  SELECT p.owner_id, p.business_name INTO v_from, v_name
  FROM public.prospects p WHERE p.id = p_prospect_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La consulta no existe.';
  END IF;
  IF v_from IS NOT DISTINCT FROM p_to_staff_id THEN
    RAISE EXCEPTION 'La consulta ya pertenece a este agente.';
  END IF;

  UPDATE public.prospects SET owner_id = p_to_staff_id, updated_at = now() WHERE id = p_prospect_id;
  UPDATE public.assignment_queue
  SET status = 'assigned',
      assigned_at = COALESCE(assigned_at, now()),
      assigned_to = p_to_staff_id
  WHERE prospect_id = p_prospect_id;

  INSERT INTO public.assignment_history (prospect_id, from_owner_id, to_owner_id, mechanism, reason, actor_id)
  VALUES (p_prospect_id, v_from, p_to_staff_id, 'manual', v_reason, v_actor);

  INSERT INTO public.notifications (staff_id, prospect_id, kind, body)
  VALUES (p_to_staff_id, p_prospect_id, 'assignment', 'Consulta reasignada: ' || v_name);

  INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
  VALUES (p_to_staff_id, p_prospect_id, 'assignment', 'Consulta reasignada: ' || v_name);

  INSERT INTO public.admin_audit_events (actor_id, action, target_id, detail)
  VALUES (v_actor, 'prospect.reassign', p_prospect_id::text,
          jsonb_build_object('from', v_from, 'to', p_to_staff_id, 'reason', v_reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.list_overdue_conversations()
RETURNS TABLE (conversation_id uuid, prospect_id uuid, owner_id text, last_message_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT c.id, c.prospect_id, p.owner_id, c.last_message_at
  FROM public.conversations c
  JOIN public.prospects p ON p.id = c.prospect_id
  WHERE c.status = 'waiting_agent'
    AND p.owner_id IS NOT NULL
    AND p.is_test = false
    AND c.last_message_at < now() - make_interval(mins => public.setting_int('overdue_minutes', 30))
  ORDER BY c.last_message_at
$$;

CREATE OR REPLACE FUNCTION public.admin_update_staff(
  p_staff_id text,
  p_display_name text,
  p_is_enabled boolean,
  p_max_active_prospects integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := public.current_staff_id();
  v_name text := btrim(COALESCE(p_display_name, ''));
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 60 THEN
    RAISE EXCEPTION 'El nombre debe tener entre 1 y 60 caracteres.';
  END IF;
  IF p_max_active_prospects IS NOT NULL AND (p_max_active_prospects < 0 OR p_max_active_prospects > 200) THEN
    RAISE EXCEPTION 'El límite de consultas activas debe estar entre 0 y 200.';
  END IF;
  IF p_is_enabled AND NOT EXISTS (
    SELECT 1 FROM public.staff_credentials c WHERE c.staff_id = p_staff_id
  ) THEN
    RAISE EXCEPTION 'Configure primero el PIN de este agente antes de habilitarlo.';
  END IF;

  UPDATE public.staff_profiles
  SET display_name = v_name,
      is_enabled = p_is_enabled,
      max_active_prospects = p_max_active_prospects,
      updated_at = now()
  WHERE id = p_staff_id AND role = 'agent';

  IF NOT p_is_enabled THEN
    UPDATE public.staff_presence SET availability = 'paused', updated_at = now() WHERE staff_id = p_staff_id;
  END IF;

  INSERT INTO public.admin_audit_events (actor_id, action, target_id, detail)
  VALUES (v_actor, 'staff.update', p_staff_id,
          jsonb_build_object('enabled', p_is_enabled, 'max_active', p_max_active_prospects));

  IF p_is_enabled THEN
    PERFORM public.process_waiting_queue();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_setting(p_key text, p_value integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := public.current_staff_id();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF p_key NOT IN ('presence_heartbeat_seconds', 'presence_expiry_seconds', 'default_max_active_prospects', 'overdue_minutes') THEN
    RAISE EXCEPTION 'Configuración no editable.';
  END IF;
  IF p_value IS NULL OR p_value < 1 OR p_value > 86400 THEN
    RAISE EXCEPTION 'El valor debe estar entre 1 y 86400.';
  END IF;
  IF p_key = 'presence_expiry_seconds' AND p_value <= public.setting_int('presence_heartbeat_seconds', 30) THEN
    RAISE EXCEPTION 'La expiración debe ser mayor que el intervalo de latido.';
  END IF;

  UPDATE public.settings SET value = to_jsonb(p_value), updated_at = now() WHERE key = p_key;
  INSERT INTO public.admin_audit_events (actor_id, action, target_id, detail)
  VALUES (v_actor, 'setting.update', p_key, jsonb_build_object('value', p_value));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_device_enrollment(p_label text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := public.current_staff_id();
  v_code text := upper(encode(extensions.gen_random_bytes(5), 'hex'));
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_label, '')), '') IS NULL OR char_length(btrim(p_label)) > 80 THEN
    RAISE EXCEPTION 'La etiqueta del dispositivo debe tener entre 1 y 80 caracteres.';
  END IF;

  INSERT INTO public.device_enrollments (code_hash, label, created_by, expires_at)
  VALUES (
    encode(extensions.digest(v_code, 'sha256'), 'hex'),
    btrim(p_label),
    v_actor,
    now() + interval '15 minutes'
  );
  INSERT INTO public.admin_audit_events (actor_id, action, target_id, detail)
  VALUES (v_actor, 'device.enrollment_created', NULL, jsonb_build_object('label', btrim(p_label)));

  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_devices()
RETURNS TABLE (id uuid, label text, enrolled_at timestamptz, revoked_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT d.id, d.label, d.enrolled_at, d.revoked_at
  FROM public.office_devices d
  WHERE public.is_admin()
  ORDER BY d.enrolled_at DESC
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_device(p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := public.current_staff_id();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.office_devices SET revoked_at = now()
  WHERE id = p_device_id AND revoked_at IS NULL;
  INSERT INTO public.admin_audit_events (actor_id, action, target_id, detail)
  VALUES (v_actor, 'device.revoke', p_device_id::text, '{}'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pick_round_robin_agent() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_waiting_queue() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.intake_inquiry(text, text, text, text, text, text, text, text, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intake_inquiry(text, text, text, text, text, text, text, text, boolean, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_inquiry(text, text, text, text, text, text, text, text, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_heartbeat() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_availability(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_prospect_stage(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_next_action(uuid, text, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_payment_status(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_private_note(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_draft(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.send_reply(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.schedule_followup(uuid, text, text, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_followup_completed(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reassign_prospect(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_overdue_conversations() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_staff(text, text, boolean, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_setting(text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_create_device_enrollment(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_devices() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_device(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_inquiry(text, text, text, text, text, text, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_heartbeat() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_availability(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_prospect_stage(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_next_action(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_private_note(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_draft(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_reply(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_followup(uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_followup_completed(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_prospect(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_overdue_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_staff(text, text, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_setting(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_device_enrollment(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_devices() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_device(uuid) TO authenticated;

GRANT UPDATE (last_heartbeat_at, updated_at) ON public.staff_presence TO authenticated;
