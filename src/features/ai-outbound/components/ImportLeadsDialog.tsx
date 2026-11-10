import { useMemo, useState, type ChangeEvent } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import {
  MAX_LEADS_PER_IMPORT,
  parseLeadRows,
} from '@/features/ai-outbound/models/outboundLead';
import { readLeadFile } from '@/features/ai-outbound/models/leadFile';
import { importLeads } from '@/features/ai-outbound/services/outboundCampaigns';

interface ImportLeadsDialogProps {
  open: boolean;
  campaignId: string;
  doNotCallPhones: ReadonlySet<string>;
  onClose: () => void;
  onImported: () => void;
}

export function ImportLeadsDialog({
  open,
  campaignId,
  doNotCallPhones,
  onClose,
  onImported,
}: ImportLeadsDialogProps) {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const preview = useMemo(() => parseLeadRows(rows, doNotCallPhones), [rows, doNotCallPhones]);
  const canImport = preview.valid.length > 0 && !preview.tooMany && !saving && !reading;

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setReading(true);
    setError(null);
    setResult(null);
    try {
      setRows(await readLeadFile(file));
      setFileName(file.name);
    } catch {
      setRows([]);
      setFileName('');
      setError('No se pudo leer el archivo. Usa un archivo .xlsx o .csv.');
    } finally {
      setReading(false);
    }
  };

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
      setRows([]);
      setFileName('');
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron importar los contactos.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setRows([]);
    setFileName('');
    setResult(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      title="Importar contactos"
      description="Sube un archivo .xlsx o .csv con las columnas: teléfono, negocio, contacto y tipo de negocio. La primera fila puede ser de encabezados."
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
        <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-700">
          Archivo de contactos
          <input
            type="file"
            accept=".xlsx,.csv,text/csv"
            onChange={(event) => void handleFile(event)}
            disabled={reading || saving}
            className="text-sm font-normal text-neutral-700 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-2"
          />
        </label>
        {reading ? <p className="text-sm text-neutral-500">Leyendo archivo...</p> : null}

        {fileName && !reading ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-neutral-700">
              {fileName}: listos para importar <strong>{preview.valid.length}</strong>
              {preview.duplicates > 0 ? ` - repetidos en el archivo: ${preview.duplicates}` : ''}
              {preview.doNotCall > 0 ? ` - en lista de no llamar: ${preview.doNotCall}` : ''}
            </p>
            {preview.valid.length > 0 ? (
              <div className="max-h-48 overflow-auto rounded-lg border border-neutral-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-neutral-50 text-neutral-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Teléfono</th>
                      <th className="px-3 py-2 font-medium">Negocio</th>
                      <th className="px-3 py-2 font-medium">Contacto</th>
                      <th className="px-3 py-2 font-medium">Tipo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {preview.valid.slice(0, 50).map((lead) => (
                      <tr key={lead.phone}>
                        <td className="px-3 py-1.5 font-mono">{lead.phone}</td>
                        <td className="px-3 py-1.5">{lead.business_name || '-'}</td>
                        <td className="px-3 py-1.5">{lead.contact_name || '-'}</td>
                        <td className="px-3 py-1.5">{lead.business_type || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {preview.invalid.length > 0 ? (
              <div role="alert" className="text-danger-700">
                <p>No válidos ({preview.invalid.length}). Revisa estas filas:</p>
                <ul className="mt-1 max-h-24 list-disc overflow-y-auto pl-5">
                  {preview.invalid.slice(0, 20).map((item) => (
                    <li key={item.line}>
                      Fila {item.line}: {item.text}
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
