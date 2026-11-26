import { useState, type FormEvent } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import { appLocalInputToIso, isoToAppLocalInput } from '@/app/dates';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import type { Followup } from '@/features/followups/models/followup';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

interface RescheduleFollowupDialogProps {
  followup: Followup;
  onClose: () => void;
  onSaved: (followup: Followup) => void;
}

export function RescheduleFollowupDialog({
  followup,
  onClose,
  onSaved,
}: RescheduleFollowupDialogProps) {
  const { followups } = useAppServices();
  // Same time tomorrow; an old follow-up moves to at least an hour from now.
  const [dueLocal, setDueLocal] = useState(() =>
    isoToAppLocalInput(
      new Date(Math.max(Date.parse(followup.dueAt) + DAY_MS, Date.now() + HOUR_MS)).toISOString()
    )
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dueLocal) {
      setError('Indica la nueva fecha y hora.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await followups.reschedule(followup.id, appLocalInputToIso(dueLocal)));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo reprogramar el seguimiento.');
      setSaving(false);
    }
  };

  return (
    <Dialog open title="Reprogramar seguimiento" description={followup.title} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <TextField
          label="Nueva fecha y hora (hora del Pacífico)"
          type="datetime-local"
          value={dueLocal}
          onChange={(event) => setDueLocal(event.target.value)}
        />
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Guardando...' : 'Reprogramar'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
