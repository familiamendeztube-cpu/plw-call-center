import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import { PIN_LENGTH } from '@/features/auth/models/demoAccess';
import { isValidPin, type AdminAgent } from '@/features/admin/models/adminAgents';
import { setAgentPin } from '@/features/admin/services/adminAgentService';

interface AgentPinDialogProps {
  agent: AdminAgent;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const PIN_MISMATCH = 'Los dos PIN no coinciden. Escríbelos de nuevo.';
const PIN_INVALID = `El PIN debe tener exactamente ${PIN_LENGTH} dígitos.`;

// maxLength only limits keystrokes. A password manager can fill in any length.
function cleanPin(value: string): string {
  return value.replace(/\D/g, '').slice(0, PIN_LENGTH);
}

export function AgentPinDialog({ agent, onClose, onSaved }: AgentPinDialogProps) {
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValidPin(pin)) {
      setError(PIN_INVALID);
      return;
    }
    if (pin !== confirmation) {
      setError(PIN_MISMATCH);
      return;
    }

    const enteredPin = pin;
    setPin('');
    setConfirmation('');
    setError(null);
    setSubmitting(true);
    try {
      await setAgentPin(agent.id, enteredPin);
      onSaved(`PIN de ${agent.displayName} actualizado. Sus sesiones abiertas se cerraron.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar el PIN.');
      setSubmitting(false);
    }
  };

  const canSubmit = !submitting && pin.length === PIN_LENGTH && confirmation.length === PIN_LENGTH;

  return (
    <Dialog
      open
      title={
        agent.hasPin ? `Cambiar PIN de ${agent.displayName}` : `Crear PIN de ${agent.displayName}`
      }
      description="El PIN no se muestra después de guardarlo. Entrégalo en persona al agente."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" form="agent-pin-form" disabled={!canSubmit}>
            {submitting ? 'Guardando...' : 'Guardar PIN'}
          </Button>
        </>
      }
    >
      <form
        id="agent-pin-form"
        className="flex flex-col gap-5"
        onSubmit={submit}
        autoComplete="off"
      >
        <TextField
          label="Nuevo PIN de cuatro dígitos"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={PIN_LENGTH}
          value={pin}
          onChange={(event) => setPin(cleanPin(event.target.value))}
          disabled={submitting}
        />
        <TextField
          label="Confirmar PIN"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={PIN_LENGTH}
          value={confirmation}
          onChange={(event) => setConfirmation(cleanPin(event.target.value))}
          disabled={submitting}
        />
        <p className="text-sm text-neutral-500">
          Al guardar, las sesiones abiertas de {agent.displayName} se cierran y deberá ingresar de
          nuevo con el PIN nuevo.
        </p>
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-700">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
