import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FlaskConical, Settings, ShieldCheck } from 'lucide-react';
import { IS_DEMO_MODE } from '@/app/appConfig';
import { DEMO_ADMIN_PIN } from '@/features/auth/models/demoAccess';
import { DeviceEnrollmentPanel } from '@/features/auth/components/DeviceEnrollmentPanel';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { PlwWordmark } from '@/components/ui/PlwWordmark';
import { DemoModeBadge } from '@/components/ui/DemoModeBadge';

const PASSCODE_MIN_LENGTH = 12;

interface AdminLoginScreenProps {
  onSignIn: (passcode: string) => Promise<string | null>;
  onEnrollDevice: (code: string, label: string) => Promise<string | null>;
  deviceRequired: boolean;
  notice: string | null;
  setupAvailable: boolean;
}

export function AdminLoginScreen({
  onSignIn,
  onEnrollDevice,
  deviceRequired,
  notice,
  setupAvailable,
}: AdminLoginScreenProps) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (entered: string) => {
    setSubmitting(true);
    setError(null);
    const message = await onSignIn(entered);
    setSubmitting(false);
    if (message) {
      setError(message);
      setPasscode('');
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passcode.length >= PASSCODE_MIN_LENGTH && !submitting) void submit(passcode);
  };

  const shownError = error ?? (deviceRequired ? null : notice);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <PlwWordmark tone="light" />
        <DemoModeBadge />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-12 sm:px-8">
        <div className="w-full max-w-md animate-fade-in glass-panel-strong p-6 shadow-raised sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-plw-navy text-plw-gold-soft">
              <ShieldCheck size={18} aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-plw-ink">Acceso de administrador</h1>
              <p className="text-sm text-neutral-500">Ingresa la contraseña de administración.</p>
            </div>
          </div>

          {setupAvailable ? (
            <div className="mb-6 rounded-[18px] border border-plw-gold/40 bg-white/[0.04] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-plw-gold-soft">
                <Settings size={16} aria-hidden="true" className="text-plw-gold" />
                Primera configuración pendiente
              </div>
              <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                Antes de ingresar, cree la contraseña del administrador en este equipo.
              </p>
              <Link
                to="/configuracion-inicial"
                className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-plw-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-plw-navy/90"
              >
                Configurar acceso del propietario
              </Link>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <TextField
              label="Contraseña"
              type="password"
              autoComplete="current-password"
              value={passcode}
              onChange={(event) => {
                setError(null);
                setPasscode(event.target.value);
              }}
              hint={`Mínimo ${PASSCODE_MIN_LENGTH} caracteres.`}
              disabled={submitting}
            />
            {shownError ? (
              <p role="alert" className="text-sm font-medium text-danger-700">
                {shownError}
              </p>
            ) : null}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={passcode.length < PASSCODE_MIN_LENGTH || submitting}
            >
              Ingresar
            </Button>
          </form>

          {deviceRequired ? (
            <div className="mt-6">
              <DeviceEnrollmentPanel onEnroll={onEnrollDevice} />
            </div>
          ) : null}

          {IS_DEMO_MODE ? (
            <div className="mt-6 rounded-[18px] border border-dashed border-plw-gold/40 bg-white/[0.04] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-plw-gold-soft">
                <FlaskConical size={16} aria-hidden="true" className="text-plw-gold" />
                Acceso de demostración
              </div>
              <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                Contraseña de demostración: {DEMO_ADMIN_PIN}. Datos ficticios.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3 w-full"
                disabled={submitting}
                onClick={() => void submit(DEMO_ADMIN_PIN)}
              >
                Entrar en demostración como administrador
              </Button>
            </div>
          ) : null}

          <div className="mt-6 flex justify-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-plw-gold-soft transition-colors hover:text-plw-gold"
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
