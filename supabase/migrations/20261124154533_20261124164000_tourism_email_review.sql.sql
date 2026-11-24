/*
# Tourism email review — manual confirmation of unclear emails

## Purpose
When the AI agent (Ana) asks for an email but the dictated address is unclear, the call
ends with outcome EMAIL_INFO_REQUESTED and no confirmed contact_email. Alejandro must
review the recording and confirm the address. This migration adds:

1. A `reviewed_email` column on `tourism_calls` so manual review survives provider retries
   (which replace `tourism_calls.details`).
2. A `pending_tourism_emails()` SQL function (SECURITY DEFINER) that returns calls where
   the email was requested but not confirmed, scoped to the current agent's prospects.
3. A `verify_tourism_email(p_request, p_email)` plpgsql function (SECURITY DEFINER) that
   validates the email address, verifies ownership, stores it on both the call and the
   prospect, and logs an activity event.

## New columns
- `tourism_calls.reviewed_email` (text, nullable): the manually-confirmed email address.

## New functions
- `pending_tourism_emails()`: returns rows for calls with EMAIL_INFO_REQUESTED or
  email_requested=true where no contact_email was captured and no manual review yet.
  Scoped to the current staff member's owned prospects.
- `verify_tourism_email(uuid, text)`: validates and stores the confirmed email.

## Security
- Both functions are SECURITY DEFINER with search_path locked to public, pg_temp.
- EXECUTE revoked from PUBLIC and anon; granted only to authenticated.
- Ownership enforced via `current_staff_id()` matching `prospects.owner_id`.
*/

-- Manual review survives provider retries, which replace tourism_calls.details.
ALTER TABLE public.tourism_calls ADD COLUMN IF NOT EXISTS reviewed_email text;

CREATE OR REPLACE FUNCTION public.pending_tourism_emails()
RETURNS TABLE (request_id uuid, business text, excerpt text, start_seconds integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.business_name, left(c.details->>'notes',300),
    (SELECT greatest(0, floor((t->>'time_in_call_secs')::numeric)::integer - 3)
     FROM jsonb_array_elements(c.transcript) WITH ORDINALITY AS lines(t, n)
     WHERE t->>'message' ~* '(correo|arroba|e-?mail)' AND t->>'time_in_call_secs' ~ '^[0-9]{1,6}(\.[0-9]+)?$'
     ORDER BY n LIMIT 1)
  FROM tourism_calls c JOIN ai_call_requests r USING (conversation_id)
  JOIN prospects p ON p.id = r.prospect_id
  WHERE p.owner_id = current_staff_id() AND NOT c.is_test AND c.reviewed_email IS NULL
    AND (c.outcome = 'EMAIL_INFO_REQUESTED' OR c.details->>'email_requested' = 'true'
         OR c.details->>'notes' ILIKE '%correo sin confirmar%')
    AND nullif(c.details->>'contact_email','') IS NULL
  ORDER BY c.created_at LIMIT 100
$$;

CREATE OR REPLACE FUNCTION public.verify_tourism_email(p_request uuid, p_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_call uuid;
  v_prospect uuid;
BEGIN
  IF v_email IS NULL OR length(v_email)>254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Revise la dirección de correo.';
  END IF;
  SELECT c.id, p.id INTO v_call, v_prospect FROM tourism_calls c
    JOIN ai_call_requests r USING (conversation_id) JOIN prospects p ON p.id=r.prospect_id
    WHERE r.id=p_request AND p.owner_id=current_staff_id() AND NOT c.is_test
      AND c.reviewed_email IS NULL AND nullif(c.details->>'contact_email','') IS NULL
      AND (c.outcome='EMAIL_INFO_REQUESTED' OR c.details->>'email_requested'='true'
           OR c.details->>'notes' ILIKE '%correo sin confirmar%')
    FOR UPDATE OF c,p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta revisión ya se resolvió o no está asignada a usted.'; END IF;
  UPDATE tourism_calls SET reviewed_email=v_email WHERE id=v_call;
  UPDATE prospects SET email=v_email WHERE id=v_prospect;
  INSERT INTO activity_events(agent_id,prospect_id,kind,summary)
    VALUES(current_staff_id(),v_prospect,'note','Correo de turismo verificado al revisar la llamada: ' || v_email);
END;
$$;
REVOKE ALL ON FUNCTION public.pending_tourism_emails(), public.verify_tourism_email(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pending_tourism_emails(), public.verify_tourism_email(uuid,text) TO authenticated;