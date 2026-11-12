/*
# Agents can correct a customer's name and details

1. Plain-English summary
- Owner's request (2026-11-12): customers that came from the AI often have the wrong name or
  details, so the agent must be able to fix them.
- The customer's agent (or an administrator) can change the business name, contact name,
  phone, business type and "what they want to improve". Email stays as it arrived: replies
  are threaded by it.
- The AI call cards of that customer show the corrected names too, and a dentist from
  Anna's list gets the corrected clinic and contact name on the dentist list, so Anna's
  next call uses them. The dentist's dialed number is never changed here.

2. Changed objects
- New function set_prospect_details (agent of the customer, or administrator).

3. Security
- Same check as changing the sales stage: can_access_prospect. Table limits (name 1-160
  characters, etc.) still apply.
*/

CREATE OR REPLACE FUNCTION public.set_prospect_details(
  p_prospect_id uuid,
  p_business_name text,
  p_contact_name text,
  p_phone text,
  p_business_category text,
  p_service_interest text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name text := btrim(COALESCE(p_business_name, ''));
  v_contact text := btrim(COALESCE(p_contact_name, ''));
  v_key text;
BEGIN
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'El nombre del negocio es obligatorio.';
  END IF;

  UPDATE public.prospects
  SET business_name = v_name,
      contact_name = v_contact,
      phone = btrim(COALESCE(p_phone, '')),
      business_category = btrim(COALESCE(p_business_category, '')),
      service_interest = btrim(COALESCE(p_service_interest, '')),
      updated_at = now()
  WHERE id = p_prospect_id
  RETURNING idempotency_key INTO v_key;

  UPDATE public.ai_call_requests
  SET business_name = v_name, customer_name = NULLIF(v_contact, '')
  WHERE prospect_id = p_prospect_id;

  UPDATE public.dental_leads
  SET business_name = v_name, contact_name = v_contact, updated_at = now()
  WHERE 'dental:' || id = v_key;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_prospect_details(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_prospect_details(uuid, text, text, text, text, text) TO authenticated;
