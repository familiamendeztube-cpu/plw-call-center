import { useMemo, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import {
  MAX_LEADS_PER_IMPORT,
  parseLeadImport,
} from '@/features/ai-outbound/models/outboundLead';
import { importLeads } from '@/features/ai-outbound/services/outboundCampaigns';

interface ImportLeadsDialogProps {
  open: boolean;
  campaignId: string;
  onClose: () => void;
  onImported: () => void;
}

const PLACEHOLDER = `8888-1234, Juan Pérez, Ferretería Pérez
2222-5678, María Soto, Soto Textiles`;

export function ImportLeadsDialog({ open, campaignId, onClose, onImported }: ImportLeadsDialogProps) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const preview = useMemo(() => parseLeadImport(text), [text]);
  const canImport = preview.valid.length > 0 && !preview.tooMany && !saving;

  const handleImport = async () => {
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const inserted = await importLeads(campaignId, preview.valid);
      const skipped = preview.valid.length - inserted;
      setResult(
        `Se agregaron ${inserted} contactos.${skipped > 0 ? ` ${skipped} ya estaban en la campaña.` : ''}`
      );
      setText('');
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron importar los contactos.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      title="Importar contactos"
      description="Una línea por contacto: teléfono, nombre y negocio, separados por coma. Solo se aceptan números de Costa Rica de 8 dígitos."
      onClose={handleClose}
      widthClass="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={saving}>
            Cerrar
          </Button>
          <Button onClick={() => void handleImport()} disabled={!canImport}>
            {saving ? 'Importando...' : `Importar ${preview.valid.length} contactos`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <textarea
          aria-label="Lista de contactos"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setResult(null);
          }}
          rows={8}
          placeholder={PLACEHOLDER}
          className="rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm text-plw-ink"
        />
        {text.trim() ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-neutral-700">
              Listos para importar: <strong>{preview.valid.length}</strong>
              {preview.duplicates > 0 ? ` - repetidos en la lista: ${preview.duplicates}` : ''}
            </p>
            {preview.invalid.length > 0 ? (
              <div role="alert" className="text-danger-700">
                <p>
                  No válidos ({preview.invalid.length}). Revisa estas líneas:
                </p>
                <ul className="mt-1 max-h-24 list-disc overflow-y-auto pl-5">
                  {preview.invalid.slice(0, 20).map((item) => (
                    <li key={item.line}>
                      Línea {item.line}: {item.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preview.tooMany ? (
              <p role="alert" className="text-danger-700">
                Importa como máximo {MAX_LEADS_PER_IMPORT} contactos a la vez.
              </p>
            ) : null}
          </div>
        ) : null}
        {result ? <p role="status" className="text-sm text-success-700">{result}</p> : null}
        {error ? (
          <p role="alert" className="text-sm text-danger-700">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
