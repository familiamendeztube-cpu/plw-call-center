import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { DENTAL_STATUS, type DentalLead, type DentalStatus } from '../models/dentalLead';
import { saveDentalLead } from '../services/dentalLeads';
export function DentalLeadEditor({
  lead,
  onSaved,
  onCancel,
}: {
  lead: DentalLead;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState(lead.status);
  const [notes, setNotes] = useState(lead.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    try {
      await saveDentalLead(lead.id, status, notes);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-3 border-t border-neutral-200 bg-plw-ivory p-4">
      <label className="grid gap-1 text-sm">
        Resultado
        <select
          aria-label={`Resultado de ${lead.business_name}`}
          value={status}
          disabled={busy || lead.status === 'do_not_call'}
          onChange={(e) => setStatus(e.target.value as DentalStatus)}
          className="h-11 rounded-lg border bg-white px-3"
        >
          {Object.entries(DENTAL_STATUS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Notas comerciales
        <textarea
          aria-label={`Notas de ${lead.business_name}`}
          value={notes}
          maxLength={2000}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-24 rounded-lg border bg-white p-3"
          placeholder="Nombre del encargado, interés y próxima acción. No incluya datos de pacientes."
        />
      </label>
      {status === 'do_not_call' && (
        <p className="text-sm text-danger-700">
          Se bloqueará este teléfono en todas las campañas de llamadas.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar resultado'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
