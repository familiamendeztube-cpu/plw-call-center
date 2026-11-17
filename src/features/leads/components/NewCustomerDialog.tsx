import { useId, useState, type FormEvent } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import type { AgentId } from '@/features/auth/models/agent';
import type { NewCustomerInput } from '@/features/leads/services/leadService';
import type { Prospect } from '@/features/leads/models/prospect';

const FIELDS: [key: keyof NewCustomerInput, label: string, maxLength: number, type?: string][] = [
  ['businessName', 'Nombre del negocio', 160],
  ['contactName', 'Nombre del contacto', 120],
  ['phone', 'Teléfono', 40, 'tel'],
  ['email', 'Correo', 254, 'email'],
  ['businessCategory', 'Giro del negocio', 120],
  ['serviceInterest', 'Qué quiere mejorar', 160],
];

/**
 * A customer the agent found themselves: a walk-in, a referral, a caller not on file. It stays
 * with the agent who adds it; a number or email that already belongs to someone else is refused.
 */
export function NewCustomerDialog({
  agentId,
  initialPhone = '',
  onClose,
  onCreated,
}: {
  agentId: AgentId;
  initialPhone?: string;
  onClose: () => void;
  onCreated: (prospect: Prospect) => void;
}) {
  const { leads } = useAppServices();
  const formId = useId();
  const [input, setInput] = useState<NewCustomerInput>({
    businessName: '',
    contactName: '',
    phone: initialPhone,
    email: '',
    businessCategory: '',
    serviceInterest: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!input.phone.trim() && !input.email.trim()) {
      setError('Agrega un teléfono o un correo para poder contactarlo.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onCreated(await leads.createProspect(input, agentId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo agregar el cliente.');
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title="Nuevo cliente"
      description="Queda asignado a ti. Si el número ya es tu cliente, se abre ese cliente."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={saving}>
            {saving ? 'Guardando…' : 'Agregar cliente'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void save(event)} className="grid gap-4">
        {FIELDS.map(([key, label, maxLength, type]) => (
          <TextField
            key={key}
            label={label}
            type={type}
            value={input[key]}
            maxLength={maxLength}
            required={key === 'businessName'}
            onChange={(event) => setInput((current) => ({ ...current, [key]: event.target.value }))}
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
