import { useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import type { Agent, AgentId } from '@/features/auth/models/agent';
import {
  REASSIGN_REASON_MAX_LENGTH,
  validateReassignReason,
} from '@/features/assignment/models/assignment';
import type { Prospect } from '@/features/leads/models/prospect';
import { useAppServices } from '@/app/ServicesContext';
import { fieldClass, textareaClass } from '@/features/assignment/components/formStyles';

interface ReassignDialogProps {
  prospect: Prospect;
  agents: Agent[];
  onClose: () => void;
  onDone: () => void;
}

export function ReassignDialog({ prospect, agents, onClose, onDone }: ReassignDialogProps) {
  const services = useAppServices();
  const targets = agents.filter((agent) => agent.id !== prospect.assignedAgentId);
  const [targetId, setTargetId] = useState<AgentId | ''>('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const verb = prospect.assignedAgentId ? 'Reasignar' : 'Asignar';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (targetId === '') {
      setError('Selecciona el agente de destino.');
      return;
    }
    const reasonError = validateReassignReason(reason);
    if (reasonError) {
      setError(reasonError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await services.assignments.reassignProspect({
        prospectId: prospect.id,
        toAgentId: targetId,
        reason,
      });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo reasignar el prospecto.');
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      title={`${verb} prospecto`}
      description={[prospect.businessName, prospect.contactName].filter(Boolean).join(' · ')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" form="reassign-prospect-form" disabled={submitting}>
            {submitting ? 'Guardando...' : `Confirmar: ${verb.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <form id="reassign-prospect-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Agente de destino</span>
          <select
            className={fieldClass}
            value={targetId}
            onChange={(event) => setTargetId(event.target.value as AgentId | '')}
            required
          >
            <option value="" disabled>
              Seleccionar agente
            </option>
            {targets.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Motivo del cambio</span>
          <textarea
            className={textareaClass}
            value={reason}
            maxLength={REASSIGN_REASON_MAX_LENGTH}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explica por qué cambia de responsable"
            required
          />
          <span className="text-xs text-neutral-500">
            {reason.trim().length} / {REASSIGN_REASON_MAX_LENGTH}
          </span>
        </label>
        {error ? (
          <p role="alert" className="text-sm text-danger-700">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
