import { useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { createCampaign } from '@/features/ai-outbound/services/outboundCampaigns';

interface CreateCampaignDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateCampaignDialog({ open, onClose, onCreated }: CreateCampaignDialogProps) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmedName = name.trim();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedName) return;
    setSaving(true);
    setError(null);
    try {
      await createCampaign({ name: trimmedName, purpose: purpose.trim() });
      setName('');
      setPurpose('');
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la campaña.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Nueva campaña"
      description="Las llamadas no se hacen desde aquí. Esta campaña solo guarda la lista de contactos."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="create-campaign-form"
            disabled={!trimmedName || saving}
          >
            {saving ? 'Creando...' : 'Crear campaña'}
          </Button>
        </>
      }
    >
      <form id="create-campaign-form" className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <TextField
          label="Nombre"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ej. Seguimiento de cotizaciones de mayo"
          required
        />
        <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-700">
          Objetivo para la IA (opcional)
          <textarea
            value={purpose}
            maxLength={1000}
            rows={3}
            onChange={(event) => setPurpose(event.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-normal text-plw-ink"
          />
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
