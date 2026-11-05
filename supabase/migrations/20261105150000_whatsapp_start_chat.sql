/*
# Agents start WhatsApp chats from PLW with a phone number and an approved template

1. Plain-English summary
- An agent types a number, picks an approved template and sends it; the chat then opens in PLW.
- The number decides the customer. If one of the agent's own customers has it, the chat joins that
  customer and the name on file is kept. A number that belongs to another agent's customer, or to one
  still waiting for assignment, is refused before anything is sent, so agents never write to each
  other's customers.
- An unknown number becomes a new customer (source 'whatsapp') of the agent who started the chat, marked
  contacted. The name the agent typed is used; the number stands in when there is none.

2. New objects
- start_whatsapp_customer (server only): before sending, finds or creates the agent's customer.
- link_whatsapp_chat (server only): once the template went out, records which Chatwoot conversation
  belongs to that customer.

3. Security
- Both run only with the service role, from the whatsapp function, which takes the agent from the
  verified session. Browsers cannot call them.
*/

CREATE OR REPLACE FUNCTION public.start_whatsapp_customer(p_agent text, p_phone text, p_name text)
RETURNS TABLE (customer uuid, conversation integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := left(btrim(COALESCE(p_phone, '')), 40);
  v_name text := left(btrim(COALESCE(p_name, '')), 120);
  v_digits text := right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 8);
  v_prospect uuid;
  v_others integer;
BEGIN
  IF char_length(v_digits) <> 8 OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles s WHERE s.id = p_agent AND s.role = 'agent' AND s.is_enabled
  ) THEN
    RAISE EXCEPTION 'Solicitud no válida.' USING ERRCODE = '22023';
  END IF;
  -- Two starts for one number at the same moment cannot create two customers.
  PERFORM pg_advisory_xact_lock(1112, hashtext(v_digits));

  -- ponytail: same last-8-digit match as record_whatsapp_message; the newest of the agent's own
  -- customers wins, without the duplicate warning, since the agent chose the number.
  SELECT (array_agg(p.id ORDER BY p.created_at DESC) FILTER (WHERE p.owner_id = p_agent))[1],
         count(*) FILTER (WHERE p.owner_id IS DISTINCT FROM p_agent)
  INTO v_prospect, v_others
  FROM public.prospects p
  WHERE NOT p.is_test AND right(regexp_replace(p.phone, '\D', '', 'g'), 8) = v_digits;

  IF v_prospect IS NULL AND v_others > 0 THEN
    RETURN; -- Someone else's customer: no row, and the function sends nothing.
  END IF;

  IF v_prospect IS NULL THEN
    INSERT INTO public.prospects (business_name, contact_name, phone, source, owner_id, stage, created_by)
    VALUES (COALESCE(NULLIF(v_name, ''), v_phone), v_name, v_phone, 'whatsapp', p_agent, 'contacted', p_agent)
    RETURNING id INTO v_prospect;
    INSERT INTO public.conversations (prospect_id, subject, status)
    VALUES (v_prospect, COALESCE(NULLIF(v_name, ''), v_phone), 'waiting_customer');
    -- Assigned by the agent's own action, not by round-robin.
    INSERT INTO public.assignment_queue (prospect_id, status, assigned_at, assigned_to)
    VALUES (v_prospect, 'assigned', now(), p_agent);
    INSERT INTO public.assignment_history (prospect_id, to_owner_id, mechanism, reason, actor_id)
    VALUES (v_prospect, p_agent, 'manual', 'Inició un chat de WhatsApp desde PLW', p_agent);
  END IF;

  RETURN QUERY
  SELECT v_prospect,
         (SELECT c.chatwoot_conversation_id FROM public.whatsapp_chats c
          WHERE c.prospect_id = v_prospect ORDER BY c.last_message_at DESC LIMIT 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.link_whatsapp_chat(p_conversation_id integer, p_prospect_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Same lock as record_whatsapp_message, so a quick reply cannot link the chat twice.
  PERFORM pg_advisory_xact_lock(1111, p_conversation_id);
  -- The agent wrote last, so nothing is unread; the customer moves to the top of their list.
  INSERT INTO public.whatsapp_chats (chatwoot_conversation_id, prospect_id, unread)
  VALUES (p_conversation_id, p_prospect_id, false)
  ON CONFLICT (chatwoot_conversation_id) DO UPDATE SET last_message_at = now();
  UPDATE public.conversations SET last_message_at = now() WHERE prospect_id = p_prospect_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_whatsapp_customer(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_whatsapp_chat(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_whatsapp_customer(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_whatsapp_chat(integer, uuid) TO service_role;
