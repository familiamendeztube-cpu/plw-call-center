-- Anna's structured call result: the owner's 13 outcome codes and the visit details
-- ElevenLabs extracts after each call. Additive and safe to re-run.
-- Existing grants and row-level security on dental_calls cover the new columns.
ALTER TABLE public.dental_calls
  ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IN (
    'APPOINTMENT_CONFIRMED','APPOINTMENT_REQUESTED','INTERESTED_FOLLOW_UP','WHATSAPP_INFO_REQUESTED',
    'RECEPTIONIST_CONTACT','DECISION_MAKER_UNAVAILABLE','CALLBACK_REQUESTED','NOT_INTERESTED',
    'DO_NOT_CALL','WRONG_NUMBER','NO_ANSWER','VOICEMAIL','TECHNICAL_FAILURE'
  )),
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
