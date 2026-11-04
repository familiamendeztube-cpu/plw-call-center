/*
# WhatsApp chats from Chatwoot, answered inside PLW under each agent's own Chatwoot user

1. Plain-English summary
- Agents read and answer a customer's WhatsApp chat on the customer's page instead of opening Chatwoot.
- The messages stay in Chatwoot. PLW stores only which Chatwoot conversation belongs to which customer.
- Each agent connects their own Chatwoot user once, so every reply carries that agent's name in Chatwoot.
- A first WhatsApp message joins the PLW customer with the same phone number, whatever name the
  WhatsApp profile shows; the customer's name is never overwritten. When several customers share the
  number, the one whose name fits the WhatsApp name wins; if none or several fit, the newest one gets
  the chat and the agent sees a warning to check who is writing. An unknown number becomes a new
  customer (source 'whatsapp') through round-robin, like an AI call.
- Each new customer message marks the customer unread, so it rises to the top of the agent's list.

2. New objects
- Table whatsapp_chats: one row per Chatwoot conversation, linked to a customer.
- Table chatwoot_agent_accounts: each agent's Chatwoot user and access token. The token is stored only
  as AES-GCM ciphertext; the key lives in the server secret CHATWOOT_TOKEN_KEY.
- record_whatsapp_message (server only): called by the chatwoot-webhook function per customer message.
- mark_whatsapp_read: clears the unread marks when the agent opens the chat.

3. Security
- Browsers read only the chats of customers they can access (owner or admin) and write nothing directly.
- Browsers cannot read chatwoot_agent_accounts at all: tokens leave only through the whatsapp function,
  which uses the caller's own token, chosen by their verified session.
- This project does not grant table access automatically, so service_role receives its grants here.
*/

CREATE TABLE IF NOT EXISTS public.whatsapp_chats (
  chatwoot_conversation_id integer PRIMARY KEY CHECK (chatwoot_conversation_id > 0),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  unread boolean NOT NULL DEFAULT true,
  -- Several customers had this number and the WhatsApp name could not tell them apart.
  ambiguous_match boolean NOT NULL DEFAULT false,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_chats_prospect_idx
  ON public.whatsapp_chats (prospect_id, last_message_at DESC);

ALTER TABLE public.whatsapp_chats ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_chats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.whatsapp_chats TO authenticated, service_role;

DROP POLICY IF EXISTS "whatsapp_chats_select_owner_or_admin" ON public.whatsapp_chats;
CREATE POLICY "whatsapp_chats_select_owner_or_admin" ON public.whatsapp_chats
  FOR SELECT TO authenticated
  USING (public.can_access_prospect(prospect_id));

CREATE TABLE IF NOT EXISTS public.chatwoot_agent_accounts (
  staff_id text PRIMARY KEY REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  -- One Chatwoot user per PLW agent: two agents can never reply under the same name.
  chatwoot_user_id integer NOT NULL UNIQUE CHECK (chatwoot_user_id > 0),
  chatwoot_name text NOT NULL CHECK (char_length(chatwoot_name) BETWEEN 1 AND 120),
  chatwoot_email text NOT NULL DEFAULT '' CHECK (char_length(chatwoot_email) <= 254),
  token_ciphertext text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chatwoot_agent_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.chatwoot_agent_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chatwoot_agent_accounts TO service_role;

CREATE OR REPLACE FUNCTION public.record_whatsapp_message(
  p_conversation_id integer,
  p_phone text,
  p_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := left(btrim(COALESCE(p_phone, '')), 40);
  v_name text := left(btrim(COALESCE(p_name, '')), 120);
  v_digits text := right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 8);
  v_prospect uuid;
  v_matches integer := 0;
  v_newest uuid;
  v_named integer := 0;
  v_named_newest uuid;
  v_ambiguous boolean := false;
BEGIN
  -- Serializes deliveries for one chat, so its first two messages cannot create two customers.
  PERFORM pg_advisory_xact_lock(1111, p_conversation_id);
  SELECT c.prospect_id INTO v_prospect
  FROM public.whatsapp_chats c WHERE c.chatwoot_conversation_id = p_conversation_id;

  IF v_prospect IS NULL THEN
    -- The number decides the customer, not the name: replies go to that number, and a WhatsApp
    -- profile name is often a nickname or the shop's name.
    -- ponytail: same last-8-digit Costa Rica match as record_ai_call.
    IF char_length(v_digits) = 8 THEN
      SELECT count(*),
             (array_agg(p.id ORDER BY p.created_at DESC))[1],
             count(*) FILTER (WHERE v_name <> '' AND p.contact_name <> ''
                                AND public.ai_same_person(p.contact_name, v_name)),
             (array_agg(p.id ORDER BY p.created_at DESC)
                FILTER (WHERE v_name <> '' AND p.contact_name <> ''
                          AND public.ai_same_person(p.contact_name, v_name)))[1]
      INTO v_matches, v_newest, v_named, v_named_newest
      FROM public.prospects p
      WHERE NOT p.is_test AND right(regexp_replace(p.phone, '\D', '', 'g'), 8) = v_digits;

      IF v_matches = 1 THEN
        v_prospect := v_newest;
      ELSIF v_matches > 1 AND v_named = 1 THEN
        v_prospect := v_named_newest;
      ELSIF v_matches > 1 THEN
        -- ponytail: moving a chat to another customer is SQL only; add an admin action if this comes up.
        v_prospect := v_newest;
        v_ambiguous := true;
      END IF;
    END IF;

    IF v_prospect IS NULL THEN
      v_prospect := public.intake_inquiry(
        left(COALESCE(NULLIF(v_name, ''), NULLIF(v_phone, ''), 'WhatsApp'), 160),
        v_name, '', v_phone, '', '', 'whatsapp', NULL, false,
        'chatwoot:' || p_conversation_id, NULL
      );
    END IF;
    INSERT INTO public.whatsapp_chats (chatwoot_conversation_id, prospect_id, ambiguous_match)
    VALUES (p_conversation_id, v_prospect, v_ambiguous);
  ELSE
    UPDATE public.whatsapp_chats SET unread = true, last_message_at = now()
    WHERE chatwoot_conversation_id = p_conversation_id;
  END IF;

  -- The unread mark the agent's customer list already shows.
  UPDATE public.conversations
  SET unread = true, last_message_at = now(), status = 'waiting_agent'
  WHERE prospect_id = v_prospect;

  RETURN v_prospect;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_whatsapp_read(p_prospect_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'Cliente no disponible.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.whatsapp_chats SET unread = false WHERE prospect_id = p_prospect_id AND unread;
  -- A WhatsApp customer has no email tab to clear the list mark, so the chat clears it.
  -- ponytail: this also clears an unread email of the same customer; keep unread per channel if that bites.
  UPDATE public.conversations SET unread = false WHERE prospect_id = p_prospect_id AND unread;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_whatsapp_message(integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_whatsapp_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_message(integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_whatsapp_read(uuid) TO authenticated;
