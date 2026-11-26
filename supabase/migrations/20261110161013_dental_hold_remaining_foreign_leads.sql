-- Recovered 2026-11-26 from the live migration history: Bolt applied this on 2026-11-10 without
-- committing the file. Holds three more dental leads whose directory name points outside
-- Costa Rica (same reason as 20261110160906).
UPDATE public.dental_leads SET
 dial_hold_reason='El nombre del directorio indica otra ciudad o país. Confirmar la ubicación antes de llamar; el teléfono y la fuente no se modificaron.',
 updated_at=now()
WHERE status='pending' AND dial_hold_reason IS NULL
 AND id IN ('ae4ca559-0516-567a-bc27-14112ceb5d6c','474cd892-58a6-526a-9605-ce2f1b7124a6','318b31e9-4b6d-5abb-acef-3a58b8bd7563');
