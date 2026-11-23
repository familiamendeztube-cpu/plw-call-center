/*
# Allow resolving a pending promised callback

1. Plain-English
   - `resolve_tourism_callback` previously only converted a `failed` callback to
     `resolved`. An agent or admin must also be able to close a `pending`
     promise (e.g. the client confirmed over WhatsApp before the dialer ran).
   - `reschedule_tourism_callback` closes the row it reschedules the same way.
   - This migration widens both status transitions from
     `failed -> resolved` to `failed|pending -> resolved`. Audit columns
     (resolved_at, resolved_by, note appended to fail_reason) behave exactly as
     before, and the first resolution still wins (idempotent).

2. Modified functions
   - `public.resolve_tourism_callback(uuid, text)`: status CASE now resolves
     both 'failed' and 'pending'.
   - `public.reschedule_tourism_callback(uuid, timestamptz, text)`: same CASE
     widening for the closed history row.

3. Security
   - Unchanged: EXECUTE stays revoked from PUBLIC/anon and granted to
     authenticated; the functions re-check the assigned agent or admin inside.
*/
CREATE OR REPLACE FUNCTION public.resolve_tourism_callback(p_callback_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_agent text;
BEGIN
  SELECT c.staff_id INTO v_agent
  FROM public.tourism_callbacks cb
  JOIN public.tourism_calls c ON c.id = cb.call_id
  WHERE cb.id = p_callback_id;
  IF v_agent IS NULL OR NOT (v_agent = public.current_staff_id() OR public.is_admin()) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  -- Idempotent: the first resolution wins; a note appends once.
  UPDATE public.tourism_callbacks
  SET status = CASE WHEN status IN ('failed', 'pending') THEN 'resolved' ELSE status END,
      resolved_at = COALESCE(resolved_at, now()),
      resolved_by = COALESCE(resolved_by, public.current_staff_id()),
      fail_reason = CASE
        WHEN COALESCE(btrim(COALESCE(p_note, '')), '') = '' THEN fail_reason
        WHEN fail_reason LIKE '%| Resuelto: ' || btrim(p_note) || '%' THEN fail_reason
        ELSE left(COALESCE(fail_reason, '') || ' | Resuelto: ' || btrim(p_note), 500)
      END
  WHERE id = p_callback_id;
END $$;

CREATE OR REPLACE FUNCTION public.reschedule_tourism_callback(p_callback_id uuid, p_new_slot timestamptz, p_note text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_agent text;
  v_lead uuid;
  v_phone text;
  v_call uuid;
  v_new_id uuid;
BEGIN
  SELECT c.staff_id, cb.lead_id, cb.phone, cb.call_id
  INTO v_agent, v_lead, v_phone, v_call
  FROM public.tourism_callbacks cb
  JOIN public.tourism_calls c ON c.id = cb.call_id
  WHERE cb.id = p_callback_id;
  IF v_agent IS NULL OR NOT (v_agent = public.current_staff_id() OR public.is_admin()) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  -- Re-running the same reschedule is a no-op.
  IF EXISTS (
    SELECT 1 FROM public.tourism_callbacks again
    WHERE again.lead_id = v_lead AND again.phone = v_phone
      AND again.status = 'pending' AND again.scheduled_for = p_new_slot
  ) THEN
    RETURN NULL;
  END IF;
  UPDATE public.tourism_callbacks
  SET status = CASE WHEN status IN ('failed', 'pending') THEN 'resolved' ELSE status END,
      resolved_at = COALESCE(resolved_at, now()),
      resolved_by = COALESCE(resolved_by, public.current_staff_id()),
      fail_reason = CASE
        WHEN COALESCE(btrim(COALESCE(p_note, '')), '') = '' THEN fail_reason
        WHEN fail_reason LIKE '%| Reagendado: ' || btrim(p_note) || '%' THEN fail_reason
        ELSE left(COALESCE(fail_reason, '') || ' | Reagendado: ' || btrim(p_note), 500)
      END
  WHERE id = p_callback_id;
  INSERT INTO public.tourism_callbacks (call_id, lead_id, phone, scheduled_for, promised_at)
  VALUES (v_call, v_lead, v_phone, p_new_slot, now())
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.resolve_tourism_callback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_tourism_callback(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reschedule_tourism_callback(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_tourism_callback(uuid, timestamptz, text) TO authenticated;
