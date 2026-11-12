import { useId, useState, type FormEvent } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import type { ProspectDetails } from '@/features/leads/services/leadService';
import type { Prospect } from '@/features/leads/models/prospect';

const FIELDS: [key: keyof ProspectDetails, label: string, maxLength: number][] = [
  ['businessName', 'Nombre del negocio', 160],
  ['contactName', 'Nombre del contacto', 120],
  ['phone', 'Teléfono', 40],
  ['businessCategory', 'Giro del negocio', 120],
  ['serviceInterest', 'Qué quiere mejorar', 160],
];

/** The AI often mishears names; the agent fixes them here. */
export function EditCustomerDialog({
  prospect,
  onClose,
  onSaved,
}: {
  prospect: Prospect;
  onClose: () => void;
  onSaved: (prospect: Prospect) => void;
}) {
  const { leads } = useAppServices();
  const formId = useId();
  const [details, setDetails] = useState<ProspectDetails>({
    businessName: prospect.businessName,
    contactName: prospect.contactName,
    phone: prospect.phone,
    businessCategory: prospect.businessCategory,
    serviceInterest: prospect.serviceInterest,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSaved(await leads.updateDetails(prospect.id, details));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el cambio.');
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title="Corregir datos del cliente"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void save(event)} className="grid gap-4">
        {FIELDS.map(([key, label, maxLength]) => (
          <TextField
            key={key}
            label={label}
            value={details[key]}
            maxLength={maxLength}
            required={key === 'businessName'}
            onChange={(event) => setDetails((d) => ({ ...d, [key]: event.target.value }))}
          />
        ))}
        {error ? (
          <p role="alert" className="text-sm text-danger-700">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
