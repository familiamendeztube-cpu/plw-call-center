/*
# A different person calling from a known number is a new customer

1. Plain-English summary
- Before: any AI call from a number that already belonged to a customer was added to that customer. Two different people using the same phone ended up merged into one customer, and the second call filled the first customer's empty fields with its own details.
- Now: the call joins the existing customer only when the caller's name fits the customer's contact name ("Pedro" fits "Pedro Picapiedra"; "Juan López" does not). Otherwise it becomes a new customer and goes through round-robin like any new call.
- Calls already merged this way are separated: each gets its own customer, kept with the agent who already has it, and the business type it wrongly filled on the other customer is cleared.

2. Changed objects
- New function ai_same_person (server only): compares two names ignoring case, accents and missing parts.
- record_ai_call: the phone match also requires ai_same_person.

3. Security
- No grants change for browsers. ai_same_person is not callable by them.
*/

-- ponytail: substring match on names ("Ana" also fits "Mariana"); compare first and last names separately if shared phones start merging.
CREATE OR REPLACE FUNCTION public.ai_same_person(p_a text, p_b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  WITH k AS (
    SELECT translate(lower(btrim(COALESCE(p_a, ''))), 'áéíóúüñ', 'aeiouun') AS a,
           translate(lower(btrim(COALESCE(p_b, ''))), 'áéíóúüñ', 'aeiouun') AS b
  )
  -- A name nobody gave counts as a match: the number is all there is to go on.
  SELECT a = '' OR b = '' OR position(a IN b) > 0 OR position(b IN a) > 0 FROM k
$$;

REVOKE EXECUTE ON FUNCTION public.ai_same_person(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_ai_call(p_call jsonb, p_route boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conversation text := p_call->>'conversation_id';
  v_phone text := COALESCE(p_call->>'callback_phone', p_call->>'caller_phone');
  v_digits text := right(regexp_replace(COALESCE(v_phone, ''), '\D', '', 'g'), 8);
  v_id uuid;
  v_prospect uuid;
BEGIN
  -- Serializes concurrent deliveries of the same call; the second one returns the first row.
  PERFORM pg_advisory_xact_lock(1110, hashtext(v_conversation));
  SELECT r.id INTO v_id FROM public.ai_call_requests r WHERE r.conversation_id = v_conversation;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  IF p_route THEN
    -- ponytail: last-8-digit match assumes Costa Rica numbers and scans prospects; index a normalized phone column if it grows.
    IF char_length(v_digits) = 8 THEN
      SELECT p.id INTO v_prospect FROM public.prospects p
      WHERE NOT p.is_test AND right(regexp_replace(p.phone, '\D', '', 'g'), 8) = v_digits
        -- Same number, different name: another person on a shared phone, so a new customer.
        AND public.ai_same_person(p.contact_name, p_call->>'customer_name')
      ORDER BY p.created_at DESC
      LIMIT 1;
    END IF;
    IF v_prospect IS NULL THEN
      v_prospect := public.intake_inquiry(
        left(COALESCE(p_call->>'business_name', p_call->>'customer_name', v_phone, 'Llamada IA'), 160),
        COALESCE(p_call->>'customer_name', ''),
        '',
        COALESCE(v_phone, ''),
        '',
        '',
        'ai_call',
        NULL,
        false,
        'elevenlabs:' || v_conversation,
        NULL
      );
    END IF;

    -- New and returning callers alike: fill only what is still empty.
    UPDATE public.prospects p
    SET contact_name = COALESCE(NULLIF(p.contact_name, ''), p_call->>'customer_name', ''),
        business_category = COALESCE(NULLIF(p.business_category, ''), p_call->>'business_type', ''),
        service_interest = COALESCE(NULLIF(p.service_interest, ''), left(p_call->>'reason', 160), ''),
        updated_at = now()
    WHERE p.id = v_prospect;
  END IF;

  INSERT INTO public.ai_call_requests (
    conversation_id, prospect_id, caller_phone, callback_phone, customer_name, business_name,
    business_type, reason, preferred_contact, preferred_time, consent, summary, call_started_at,
    call_duration_seconds, status
  )
  VALUES (
    v_conversation, v_prospect, p_call->>'caller_phone', p_call->>'callback_phone',
    p_call->>'customer_name', p_call->>'business_name', p_call->>'business_type', p_call->>'reason',
    p_call->>'preferred_contact', p_call->>'preferred_time', (p_call->>'consent')::boolean,
    p_call->>'summary', (p_call->>'call_started_at')::timestamptz,
    (p_call->>'call_duration_seconds')::integer,
    CASE WHEN p_route THEN 'pending' ELSE 'canceled' END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Separate calls that were merged into another person's customer. Re-runnable: a separated
-- call matches its own customer and is skipped. The markers let the test replay this block.
-- BEGIN repair
DO $$
DECLARE
  r record;
  v_new uuid;
  v_label text;
BEGIN
  FOR r IN
    SELECT a.id, a.conversation_id, a.customer_name, a.business_name, a.business_type, a.reason,
           COALESCE(a.callback_phone, a.caller_phone, '') AS phone, p.id AS old_id, p.owner_id
    FROM public.ai_call_requests a
    JOIN public.prospects p ON p.id = a.prospect_id
    WHERE NOT public.ai_same_person(p.contact_name, a.customer_name)
    ORDER BY a.call_started_at
  LOOP
    -- Undo the business type this call filled on the other customer.
    UPDATE public.prospects
    SET business_category = '', updated_at = now()
    WHERE id = r.old_id AND business_category <> '' AND business_category = COALESCE(r.business_type, '');

    v_label := left(COALESCE(r.business_name, r.customer_name, NULLIF(r.phone, ''), 'Llamada IA'), 160);
    INSERT INTO public.prospects (
      business_name, contact_name, phone, business_category, service_interest,
      source, idempotency_key, owner_id
    )
    VALUES (
      v_label, r.customer_name, r.phone, COALESCE(r.business_type, ''),
      COALESCE(left(r.reason, 160), ''), 'ai_call', 'elevenlabs:' || r.conversation_id, r.owner_id
    )
    RETURNING id INTO v_new;

    INSERT INTO public.conversations (prospect_id, subject) VALUES (v_new, v_label);
    -- The agent who already has the call keeps it; a call nobody had goes to round-robin below.
    INSERT INTO public.assignment_queue (prospect_id, status, assigned_at, assigned_to)
    VALUES (
      v_new,
      CASE WHEN r.owner_id IS NULL THEN 'waiting' ELSE 'assigned' END,
      CASE WHEN r.owner_id IS NULL THEN NULL ELSE now() END,
      r.owner_id
    );
    IF r.owner_id IS NOT NULL THEN
      INSERT INTO public.assignment_history (prospect_id, from_owner_id, to_owner_id, mechanism, reason)
      VALUES (v_new, NULL, r.owner_id, 'manual', 'Separado de otro cliente con el mismo teléfono');
    END IF;

    UPDATE public.ai_call_requests SET prospect_id = v_new WHERE id = r.id;
  END LOOP;

  PERFORM public.process_waiting_queue();
END $$;
-- END repair
