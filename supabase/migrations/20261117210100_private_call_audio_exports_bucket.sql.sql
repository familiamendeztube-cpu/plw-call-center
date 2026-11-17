-- Private bucket for admin audio exports: objects are only reachable through short-lived
-- signed URLs minted by the ai-call-audio function for administrators. No public access.
INSERT INTO storage.buckets (id, name, public)
VALUES ('call-audio-exports', 'call-audio-exports', false)
ON CONFLICT (id) DO NOTHING;