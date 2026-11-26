import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IS_DEMO_MODE } from '@/app/appConfig';
import { useAsync } from '@/app/useAsync';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DemoDataNote } from '@/components/ui/DemoDataNote';
import { Panel } from '@/components/ui/Panel';
import { TextField } from '@/components/ui/TextField';
import { getSupabaseClient } from '@/integrations/supabase/client';

/** The settings the server reads (setting_int); admin_set_setting refuses any other key. */
const EDITABLE: { key: string; label: string; hint: string }[] = [
  {
    key: 'default_max_active_prospects',
    label: 'Clientes activos por agente',
    hint: 'Límite para el reparto por turno cuando el agente no tiene uno propio (se cambia por agente en Agentes).',
  },
  {
    key: 'overdue_minutes',
    label: 'Minutos para marcar una conversación como vencida',
    hint: 'Una conversación sin respuesta por más tiempo aparece en Asignaciones › Vencidos.',
  },
];

async function loadSettings(): Promise<Record<string, number>> {
  const { data, error } = await getSupabaseClient()
    .from('settings')
    .select('key, value')
    .in(
      'key',
      EDITABLE.map((item) => item.key)
    );
  if (error) throw new Error('No se pudo cargar la configuración.');
  return Object.fromEntries(
    ((data ?? []) as { key: string; value: unknown }[]).map((row) => [row.key, Number(row.value)])
  );
}

export function AdminSettingsPage() {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Configuración"
        description="Parámetros generales de PLW Call Center."
        actions={<DemoDataNote />}
      />
      <Panel as="section" className="p-6">
        <dl className="divide-y divide-neutral-200">
          <Row label="Zona horaria" value="America/Los_Angeles (hora del Pacífico, con horario de verano)" />
          <Row
            label="Modo de acceso"
            value={IS_DEMO_MODE ? 'Modo demostración con datos ficticios' : 'Autenticación real'}
          />
          <Row
            label="Precios, presentaciones y plantillas"
            value={
              <Link to="/admin/material-comercial" className="font-medium text-plw-navy underline">
                Se administran en Material comercial
              </Link>
            }
          />
        </dl>
      </Panel>
      {IS_DEMO_MODE ? null : <EditableSettings />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <dt className="text-sm font-medium text-neutral-700">{label}</dt>
      <dd className="text-sm text-plw-ink">{value}</dd>
    </div>
  );
}

function EditableSettings() {
  const { state, reload } = useAsync(loadSettings, []);
  if (state.status === 'loading') return null;
  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-danger-700">
        {state.message}{' '}
        <button type="button" className="underline" onClick={reload}>
          Reintentar
        </button>
      </p>
    );
  }
  return (
    <Panel as="section" className="flex flex-col gap-6 p-6">
      {EDITABLE.map((item) => (
        <SettingForm
          key={item.key}
          name={item.key}
          label={item.label}
          hint={item.hint}
          initial={state.data[item.key]}
        />
      ))}
    </Panel>
  );
}

function SettingForm({
  name,
  label,
  hint,
  initial,
}: {
  name: string;
  label: string;
  hint: string;
  initial: number | undefined;
}) {
  const [value, setValue] = useState(initial === undefined ? '' : String(initial));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 86400) {
      setMessage({ ok: false, text: 'Escribe un número entero entre 1 y 86400.' });
      return;
    }
    setSaving(true);
    const { error } = await getSupabaseClient().rpc('admin_set_setting', {
      p_key: name,
      p_value: number,
    });
    setSaving(false);
    setMessage(
      error
        ? { ok: false, text: error.message || 'No se pudo guardar.' }
        : { ok: true, text: 'Guardado.' }
    );
  };

  return (
    <form onSubmit={(event) => void save(event)} className="flex flex-wrap items-end gap-3">
      <div className="min-w-[14rem] flex-1">
        <TextField
          label={label}
          type="number"
          min={1}
          max={86400}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <p className="mt-1 text-xs text-neutral-500">{hint}</p>
      </div>
      <Button type="submit" variant="secondary" disabled={saving}>
        {saving ? 'Guardando…' : 'Guardar'}
      </Button>
      {message ? (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={message.ok ? 'text-sm text-success-700' : 'text-sm text-danger-700'}
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
