import { useState, type FormEvent } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import { costaRicaLocalInputToIso, isoToCostaRicaLocalInput } from '@/app/dates';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import type { AgentId } from '@/features/auth/models/agent';
import type { Prospect } from '@/features/leads/models/prospect';
import {
  FOLLOWUP_KIND_LABELS,
  type Followup,
  type FollowupKind,
} from '@/features/followups/models/followup';

const KINDS: FollowupKind[] = ['callback', 'email', 'meeting'];
const ONE_HOUR_MS = 60 * 60 * 1000;

interface ScheduleFollowupDialogProps {
  agentId: AgentId;
  prospects: Prospect[];
  onClose: () => void;
  onScheduled: (followup: Followup) => void;
}

export function ScheduleFollowupDialog({
  agentId,
  prospects,
  onClose,
  onScheduled,
}: ScheduleFollowupDialogProps) {
  const { followups } = useAppServices();
  const [prospectId, setProspectId] = useState(prospects[0]?.id ?? '');
  const [kind, setKind] = useState<FollowupKind>('callback');
  const [title, setTitle] = useState('');
  const [dueLocal, setDueLocal] = useState(() =>
    isoToCostaRicaLocalInput(new Date(Date.now() + ONE_HOUR_MS).toISOString())
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!prospectId) {
      setError('Selecciona un prospecto.');
      return;
    }
    if (trimmedTitle.length === 0) {
      setError('Escribe un motivo para el seguimiento.');
      return;
    }
    if (!dueLocal) {
      setError('Indica la fecha y hora del seguimiento.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const followup = await followups.scheduleFollowup({
        prospectId,
        agentId,
        kind,
        title: trimmedTitle,
        dueAt: costaRicaLocalInputToIso(dueLocal),
      });
      onScheduled(followup);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo programar el seguimiento.');
    } finally {
      setSaving(false);
    }
  };

  const selectClass =
    'h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm text-plw-ink focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30';

  return (
    <Dialog
      open
      title="Programar seguimiento"
      description="Hora de Costa Rica. El seguimiento aparecerá en tu lista."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="followup-prospect" className="text-sm font-medium text-neutral-700">
            Prospecto
          </label>
          <select
            id="followup-prospect"
            value={prospectId}
            onChange={(event) => setProspectId(event.target.value)}
            className={selectClass}
          >
            {prospects.map((prospect) => (
              <option key={prospect.id} value={prospect.id}>
                {prospect.businessName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="followup-kind" className="text-sm font-medium text-neutral-700">
            Tipo
          </label>
          <select
            id="followup-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as FollowupKind)}
            className={selectClass}
          >
            {KINDS.map((item) => (
              <option key={item} value={item}>
                {FOLLOWUP_KIND_LABELS[item]}
              </option>
            ))}
          </select>
        </div>
        <TextField
          label="Motivo"
          value={title}
          maxLength={120}
          placeholder="Ej.: Confirmar interés en la demostración"
          onChange={(event) => setTitle(event.target.value)}
        />
        <TextField
          label="Fecha y hora"
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
          <Button type="submit" disabled={saving || prospects.length === 0}>
            {saving ? 'Programando...' : 'Programar'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
