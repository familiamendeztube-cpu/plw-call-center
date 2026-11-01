import { useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useAppServices } from '@/app/ServicesContext';
import type { NewInquiryInput } from '@/features/assignment/models/assignment';
import { textareaClass } from '@/features/assignment/components/formStyles';

interface CreateInquiryDialogProps {
  onClose: () => void;
  onDone: () => void;
}

const EMPTY_INPUT: NewInquiryInput = {
  businessName: '',
  contactName: '',
  email: '',
  phone: '',
  businessCategory: '',
  serviceInterest: '',
  source: 'Registro manual',
  notes: '',
  isTest: false,
};

function validateInquiry(input: NewInquiryInput): string | null {
  if (input.businessName.trim() === '') return 'Escribe el nombre del negocio.';
  if (input.contactName.trim() === '') return 'Escribe el nombre de la persona de contacto.';
  if (input.email.trim() === '' && input.phone.trim() === '') {
    return 'Agrega un correo o un teléfono para poder contactar al prospecto.';
  }
  return null;
}

export function CreateInquiryDialog({ onClose, onDone }: CreateInquiryDialogProps) {
  const services = useAppServices();
  const [input, setInput] = useState<NewInquiryInput>(EMPTY_INPUT);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  function update<K extends keyof NewInquiryInput>(key: K, value: NewInquiryInput[K]) {
    setInput((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateInquiry(input);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await services.assignments.createInquiry(
        {
          ...input,
          businessName: input.businessName.trim(),
          contactName: input.contactName.trim(),
          email: input.email.trim(),
          phone: input.phone.trim(),
        },
        idempotencyKey
      );
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo registrar la consulta.');
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      title="Nueva consulta"
      description="Registra una consulta recibida fuera del formulario web y asígnala según la regla del equipo."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" form="create-inquiry-form" disabled={submitting}>
            {submitting ? 'Registrando...' : 'Registrar consulta'}
          </Button>
        </>
      }
    >
      <form id="create-inquiry-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Nombre del negocio"
            value={input.businessName}
            maxLength={160}
            onChange={(event) => update('businessName', event.target.value)}
            required
          />
          <TextField
            label="Persona de contacto"
            value={input.contactName}
            maxLength={120}
            onChange={(event) => update('contactName', event.target.value)}
            required
          />
          <TextField
            label="Correo"
            type="email"
            value={input.email}
            maxLength={254}
            onChange={(event) => update('email', event.target.value)}
          />
          <TextField
            label="Teléfono"
            type="tel"
            value={input.phone}
            maxLength={40}
            onChange={(event) => update('phone', event.target.value)}
          />
          <TextField
            label="Categoría del negocio"
            value={input.businessCategory}
            maxLength={120}
            onChange={(event) => update('businessCategory', event.target.value)}
          />
          <TextField
            label="Servicio de interés"
            value={input.serviceInterest}
            maxLength={160}
            onChange={(event) => update('serviceInterest', event.target.value)}
          />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Notas</span>
          <textarea
            className={textareaClass}
            value={input.notes}
            maxLength={2000}
            onChange={(event) => update('notes', event.target.value)}
          />
        </label>
        <label className="flex items-start gap-3 text-sm text-neutral-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-plw-navy focus:ring-plw-gold"
            checked={input.isTest}
            onChange={(event) => update('isTest', event.target.checked)}
          />
          <span>Registro de prueba. Se excluye de los reportes de producción.</span>
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
