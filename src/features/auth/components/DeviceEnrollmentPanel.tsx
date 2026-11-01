import { useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

interface DeviceEnrollmentPanelProps {
  onEnroll: (code: string, label: string) => Promise<string | null>;
}

export function DeviceEnrollmentPanel({ onEnroll }: DeviceEnrollmentPanelProps) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = code.trim().length >= 4 && label.trim().length >= 1 && !submitting;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const message = await onEnroll(code.trim(), label.trim());
    setSubmitting(false);
    if (message) setError(message);
  };

  return (
    <section className="rounded-xl border border-plw-gold/40 bg-plw-ivory/60 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-plw-navy">
        <MonitorSmartphone size={16} aria-hidden="true" className="text-plw-gold" />
        Registrar este equipo
      </div>
      <p className="mt-1 text-xs leading-relaxed text-neutral-600">
        Ingresa el código de registro que te entregó el administrador. Vence a los 15 minutos.
      </p>
      <div className="mt-3 grid gap-3">
        <TextField
          label="Código de registro"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <TextField
          label="Nombre del equipo"
          placeholder="Ej. Recepción"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={80}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-danger-700">
          {error}
        </p>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        className="mt-3 w-full"
        disabled={!canSubmit}
        onClick={submit}
      >
        Registrar equipo
      </Button>
    </section>
  );
}
