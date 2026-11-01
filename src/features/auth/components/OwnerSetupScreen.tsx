import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { PlwWordmark } from '@/components/ui/PlwWordmark';
import { TextField } from '@/components/ui/TextField';

const PASSCODE_MIN_LENGTH = 12;
const COMPUTER_NAME_MAX_LENGTH = 80;

interface OwnerSetupScreenProps {
  onSubmit: (passcode: string, computerName: string) => Promise<string | null>;
}

export function OwnerSetupScreen({ onSubmit }: OwnerSetupScreenProps) {
  const [passcode, setPasscode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [computerName, setComputerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedName = computerName.trim();
  const canSubmit =
    passcode.length >= PASSCODE_MIN_LENGTH &&
    confirmation.length > 0 &&
    trimmedName.length > 0 &&
    !submitting;

  const clearSensitiveFields = () => {
    setPasscode('');
    setConfirmation('');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    if (passcode !== confirmation) {
      setError('Las contraseñas no coinciden. Revise e intente de nuevo.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const message = await onSubmit(passcode, trimmedName);
    setSubmitting(false);
    if (message) {
      setError(message);
      clearSensitiveFields();
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-plw-deep">
      <header className="flex items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <PlwWordmark tone="light" />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-12 sm:px-8">
        <div className="w-full max-w-md animate-fade-in rounded-2xl bg-white p-6 shadow-raised sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-plw-navy text-plw-gold-soft">
              <ShieldCheck size={18} aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-plw-ink">Configuración inicial</h1>
              <p className="text-sm text-neutral-500">Cree el acceso del administrador.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" autoComplete="off">
            <TextField
              label="Contraseña de administrador"
              type="password"
              autoComplete="new-password"
              value={passcode}
              onChange={(event) => {
                setError(null);
                setPasscode(event.target.value);
              }}
              hint={`Mínimo ${PASSCODE_MIN_LENGTH} caracteres.`}
              disabled={submitting}
            />
            <TextField
              label="Confirmar contraseña"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => {
                setError(null);
                setConfirmation(event.target.value);
              }}
              disabled={submitting}
            />
            <TextField
              label="Nombre de este equipo"
              type="text"
              autoComplete="off"
              maxLength={COMPUTER_NAME_MAX_LENGTH}
              value={computerName}
              onChange={(event) => {
                setError(null);
                setComputerName(event.target.value);
              }}
              hint="Por ejemplo: Equipo de recepción."
              disabled={submitting}
            />
            {error ? (
              <p role="alert" className="text-sm font-medium text-danger-700">
                {error}
              </p>
            ) : null}
            <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
              {submitting ? 'Configurando...' : 'Configurar mi acceso'}
            </Button>
          </form>

          <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-neutral-500">
            <Lock size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-plw-gold" />
            Esta pantalla solo funciona una vez. Después, ingrese con la contraseña desde el acceso
            de administrador.
          </p>

          <div className="mt-6 flex justify-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-plw-navy transition-colors hover:text-plw-gold"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Volver al ingreso de agentes
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

export function OwnerSetupUnavailable({ onRetry }: { onRetry: (() => void) | null }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-plw-deep px-4 py-12">
      <div className="mb-8">
        <PlwWordmark tone="light" />
      </div>
      <Panel className="w-full max-w-lg p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-plw-ivory text-plw-gold">
          <Lock size={22} aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-xl font-semibold text-plw-ink">Configuración no disponible</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600">
          {onRetry
            ? 'No se pudo verificar el estado de la configuración. Intente de nuevo en un momento.'
            : 'La configuración inicial no está habilitada en este momento. Contacte al equipo técnico.'}
        </p>
        {onRetry ? (
          <Button variant="secondary" className="mt-6" onClick={onRetry}>
            Reintentar
          </Button>
        ) : null}
      </Panel>
    </div>
  );
}
