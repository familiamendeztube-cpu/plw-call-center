import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import type { AdminAgent } from '@/features/admin/models/adminAgents';
import {
  saveAgentSipAccount,
  type AgentSipAccount,
} from '@/features/admin/services/sipAccountService';

interface AgentPhoneDialogProps {
  agent: AdminAgent;
  account: AgentSipAccount | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const DEFAULT_WSS_URL = 'wss://phone.professionallatinoworkers.com:8089/ws';
const DEFAULT_SIP_DOMAIN = 'phone.professionallatinoworkers.com';

export function AgentPhoneDialog({ agent, account, onClose, onSaved }: AgentPhoneDialogProps) {
  const [wssUrl, setWssUrl] = useState(account?.wssUrl ?? DEFAULT_WSS_URL);
  const [sipDomain, setSipDomain] = useState(account?.sipDomain ?? DEFAULT_SIP_DOMAIN);
  const [username, setUsername] = useState(account?.username ?? agent.id);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const enteredPassword = password;
    setPassword('');
    setError(null);
    setSubmitting(true);
    try {
      await saveAgentSipAccount({
        staffId: agent.id,
        wssUrl: wssUrl.trim(),
        sipDomain: sipDomain.trim(),
        username: username.trim(),
        password: enteredPassword.trim(),
      });
      onSaved(`Teléfono de ${agent.displayName} guardado. Se aplica en su próximo ingreso.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar el teléfono.');
      setSubmitting(false);
    }
  };

  const canSubmit =
    !submitting &&
    wssUrl.trim() !== '' &&
    sipDomain.trim() !== '' &&
    username.trim() !== '' &&
    password.trim() !== '';

  return (
    <Dialog
      open
      title={`Teléfono de ${agent.displayName}`}
      description="La contraseña se genera en el servidor telefónico y no se muestra después de guardarla."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" form="agent-phone-form" disabled={!canSubmit}>
            {submitting ? 'Guardando...' : 'Guardar teléfono'}
          </Button>
        </>
      }
    >
      <form
        id="agent-phone-form"
        className="flex flex-col gap-5"
        onSubmit={submit}
        autoComplete="off"
      >
        <TextField
          label="Servidor WSS"
          type="url"
          value={wssUrl}
          onChange={(event) => setWssUrl(event.target.value)}
          disabled={submitting}
        />
        <TextField
          label="Dominio SIP"
          value={sipDomain}
          onChange={(event) => setSipDomain(event.target.value)}
          disabled={submitting}
        />
        <TextField
          label="Usuario SIP"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={submitting}
        />
        <TextField
          label="Contraseña SIP"
          type="password"
          autoComplete="new-password"
          hint={
            account
              ? 'Ya hay una contraseña guardada. Pégala de nuevo para guardar cualquier cambio.'
              : 'Pégala desde el portapapeles. Nunca la envíes por chat ni por correo.'
          }
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={submitting}
        />
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-700">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
