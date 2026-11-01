import { useState, type FormEvent } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { TextField } from '@/components/ui/TextField';
import {
  ENROLLMENT_CODE_MINUTES,
  type OfficeEnrollmentCode,
} from '@/features/admin/models/adminAgents';
import { createOfficeEnrollmentCode } from '@/features/admin/services/adminAgentService';

const LABEL_MAX = 80;

export function OfficeEnrollmentPanel() {
  const [label, setLabel] = useState('');
  const [enrollment, setEnrollment] = useState<OfficeEnrollmentCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = label.trim().length > 0 && !submitting;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await createOfficeEnrollmentCode(label.trim());
      setEnrollment(created);
      setLabel('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo crear el código.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel as="section" className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-plw-ivory text-plw-gold">
          <MonitorSmartphone size={18} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-plw-ink">Registrar equipos de oficina</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Cada computadora debe registrarse una vez antes de que los agentes ingresen con su PIN.
          </p>
        </div>
      </div>

      <ol className="grid gap-2 text-sm text-neutral-700 sm:grid-cols-3">
        <li className="rounded-lg bg-plw-ivory/60 px-4 py-3">
          <span className="font-semibold text-plw-navy">1.</span> Crea un código para el equipo.
        </li>
        <li className="rounded-lg bg-plw-ivory/60 px-4 py-3">
          <span className="font-semibold text-plw-navy">2.</span> En ese equipo, escribe el código
          en &quot;Registrar este equipo&quot;.
        </li>
        <li className="rounded-lg bg-plw-ivory/60 px-4 py-3">
          <span className="font-semibold text-plw-navy">3.</span> Después, el agente ingresa con su
          PIN.
        </li>
      </ol>

      {enrollment ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-plw-gold/50 bg-plw-ivory p-5">
          <p className="text-sm text-neutral-600">
            Código para <span className="font-semibold text-plw-ink">{enrollment.label}</span>
          </p>
          <p className="font-mono text-3xl font-semibold tracking-[0.2em] text-plw-navy">
            {enrollment.code}
          </p>
          <p className="text-sm text-neutral-600">
            Vence en {ENROLLMENT_CODE_MINUTES} minutos y solo sirve una vez. Si no se usa a tiempo,
            crea uno nuevo.
          </p>
          <Button variant="secondary" size="sm" onClick={() => setEnrollment(null)}>
            Crear otro código
          </Button>
        </div>
      ) : (
        <form className="flex flex-col gap-4 sm:max-w-md" onSubmit={submit}>
          <TextField
            label="Nombre del equipo"
            placeholder="Ej. Recepción"
            value={label}
            maxLength={LABEL_MAX}
            onChange={(event) => setLabel(event.target.value)}
            disabled={submitting}
          />
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-700">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="self-start" disabled={!canSubmit}>
            {submitting ? 'Creando código...' : 'Crear código'}
          </Button>
        </form>
      )}
    </Panel>
  );
}
