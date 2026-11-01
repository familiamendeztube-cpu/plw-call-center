/*
# Trusted website form notification senders

1. Plain-English summary
- Adds a list of sender addresses that belong to the website or form tool. Mail from these senders that is marked as automatic and includes the customer's contact details is recorded as a customer inquiry.
- The list starts empty, so no form mail is trusted until the owner adds the sender address.

2. New table
- gmail_lead_notification_senders: address (the sender's email, lowercase, primary key), label (a human description), enabled (switch to pause one sender), created_at.

3. Security
- Row level security is enabled with no policies, so the browser cannot read or change the list.
- Only the server role can read it.

4. Important notes
- To add a sender, insert its address into this table with enabled set to true.
*/

CREATE TABLE IF NOT EXISTS public.gmail_lead_notification_senders (
  address text PRIMARY KEY CHECK (address = lower(btrim(address)) AND address <> ''),
  label text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gmail_lead_notification_senders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.gmail_lead_notification_senders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gmail_lead_notification_senders TO service_role;
