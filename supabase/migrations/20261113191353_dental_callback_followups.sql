ALTER TABLE public.followups ADD COLUMN IF NOT EXISTS source_call_id uuid REFERENCES public.dental_calls(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS followups_source_call_uidx ON public.followups (source_call_id) WHERE source_call_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.dental_call_schedule_callback(p_call_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c public.dental_calls;
  l public.dental_leads;
  v_prospect uuid;
  v_local timestamp;
  v_due timestamptz;
  v_decision text;
  v_title text;
  v_followup uuid;
BEGIN
  SELECT * INTO c FROM public.dental_calls WHERE id = p_call_id;
  IF NOT FOUND OR c.is_test OR c.lead_id IS NULL OR c.conversation_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF lower(COALESCE(c.details->>'callback_confirmed', '')) <> 'true' THEN
    RETURN NULL;
  END IF;
  IF COALESCE(c.details->>'callback_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR COALESCE(c.details->>'callback_clock', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO l FROM public.dental_leads WHERE id = c.lead_id;
  IF l.status = 'do_not_call' THEN
    RETURN NULL;
  END IF;

  SELECT r.prospect_id INTO v_prospect FROM public.ai_call_requests r WHERE r.conversation_id = c.conversation_id;
  IF v_prospect IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_local := (c.details->>'callback_date' || ' ' || (c.details->>'callback_clock'))::timestamp;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  v_due := v_local AT TIME ZONE 'America/Costa_Rica';

  v_decision := left(NULLIF(btrim(COALESCE(c.details->>'decision_maker', '')), ''), 120);
  v_title := 'Llamar a ' || COALESCE(v_decision, 'la persona encargada') || ' · ' || l.business_name;
  IF extract(isodow FROM v_local) > 5 OR v_local::time < time '09:00' OR v_local::time >= time '17:00' THEN
    v_title := 'FUERA DE HORARIO: confirmar otra hora con el cliente (ninguna llamada automática) · ' || v_title;
  END IF;

  INSERT INTO public.followups (prospect_id, agent_id, kind, title, due_at, source_call_id)
  VALUES (v_prospect, COALESCE(l.owner_staff_id, c.staff_id), 'callback', left(v_title, 200), v_due, c.id)
  ON CONFLICT (source_call_id) WHERE source_call_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_followup;

  IF v_followup IS NOT NULL THEN
    INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
    VALUES (COALESCE(l.owner_staff_id, c.staff_id), v_prospect, 'followup', left('Seguimiento de llamada de Anna: ' || v_title, 300));
  END IF;

  RETURN v_followup;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dental_call_schedule_callback(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dental_call_schedule_callback(uuid) TO service_role;
