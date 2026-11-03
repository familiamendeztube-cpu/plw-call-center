-- Server-originated completed call legs. Browser roles cannot insert or read.
CREATE TABLE public.asterisk_calls (
  unique_id text PRIMARY KEY,
  linked_id text NOT NULL,
  staff_id text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  sip_username text,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  number text NOT NULL,
  disposition text NOT NULL,
  talk_seconds integer NOT NULL CHECK (talk_seconds >= 0),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at >= started_at)
);
CREATE INDEX asterisk_calls_started_idx ON public.asterisk_calls (started_at DESC);
CREATE INDEX asterisk_calls_staff_started_idx ON public.asterisk_calls (staff_id, started_at DESC);
ALTER TABLE public.asterisk_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.asterisk_calls FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.asterisk_calls TO service_role;
