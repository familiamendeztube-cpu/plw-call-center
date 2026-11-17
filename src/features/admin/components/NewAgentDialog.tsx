import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import { createAgent } from '@/features/admin/services/adminAgentService';

export function NewAgentDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const formId = useId();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createAgent(name.trim());
      onSaved(
        `${name.trim()} fue agregado. Para que pueda entrar: créale un PIN, asígnale un teléfono y habilítalo en Editar.`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo agregar el agente.');
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title="Nuevo agente"
      description="Queda deshabilitado hasta que tenga PIN. Su línea telefónica también se crea en el servidor de Asterisk."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={saving || !name.trim()}>
            {saving ? 'Agregando…' : 'Agregar'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void save(event)} className="grid gap-4">
        <TextField
          label="Nombre visible"
          value={name}
          maxLength={60}
          required
          onChange={(event) => setName(event.target.value)}
        />
        {error ? (
          <p role="alert" className="text-sm text-danger-700">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
