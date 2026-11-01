import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import {
  CAPACITY_MAX,
  validateAgentProfile,
  type AdminAgent,
} from '@/features/admin/models/adminAgents';
import { saveAgentProfile } from '@/features/admin/services/adminAgentService';

interface AgentProfileDialogProps {
  agent: AdminAgent;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function AgentProfileDialog({ agent, onClose, onSaved }: AgentProfileDialogProps) {
  const [displayName, setDisplayName] = useState(agent.displayName);
  const [capacity, setCapacity] = useState(
    agent.maxActiveProspects === null ? '' : String(agent.maxActiveProspects)
  );
  const [isEnabled, setIsEnabled] = useState(agent.isEnabled);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateAgentProfile(displayName, capacity, isEnabled);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await saveAgentProfile(agent.id, validation.value);
      onSaved(`Cambios guardados para ${validation.value.displayName}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar. Intente de nuevo.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      title={`Editar ${agent.displayName}`}
      description="Nombre, capacidad y acceso del agente."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" form="agent-profile-form" disabled={submitting}>
            {submitting ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </>
      }
    >
      <form id="agent-profile-form" className="flex flex-col gap-5" onSubmit={submit}>
        <TextField
          label="Nombre para mostrar"
          value={displayName}
          maxLength={60}
          onChange={(event) => setDisplayName(event.target.value)}
          disabled={submitting}
        />
        <TextField
          label="Conversaciones activas máximas"
          hint={`Entre 0 y ${CAPACITY_MAX}. Déjalo vacío para no poner límite.`}
          inputMode="numeric"
          value={capacity}
          onChange={(event) => setCapacity(event.target.value)}
          disabled={submitting}
        />
        <label className="flex items-start gap-3 rounded-lg border border-neutral-200 p-4">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-plw-navy"
            checked={isEnabled}
            onChange={(event) => setIsEnabled(event.target.checked)}
            disabled={submitting}
          />
          <span className="text-sm">
            <span className="block font-medium text-plw-ink">Agente habilitado</span>
            <span className="block text-neutral-500">
              Un agente deshabilitado no puede ingresar. Para habilitarlo, primero debe tener PIN.
            </span>
          </span>
        </label>
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-700">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
