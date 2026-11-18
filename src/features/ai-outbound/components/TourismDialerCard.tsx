import { useState } from 'react';
import { isRecord, postStaffFunction, readStaffFunctionError } from '@/integrations/supabase/callStaffFunction';
import { parseCsvText, parseLeadRows } from '@/features/ai-outbound/models/outboundLead';
import { readLeadFile } from '@/features/ai-outbound/models/leadFile';
import {
  createCampaign,
  importLeads,
  listCampaignAgentIds,
  listCampaigns,
  listDoNotCallPhones,
  setCampaignAgent,
} from '@/features/ai-outbound/services/outboundCampaigns';
import type { LeadImportPreview } from '@/features/ai-outbound/models/outboundLead';

const TOURISM_CAMPAIGN_NAME = 'Turismo PLW';
const TOURISM_AGENT_ID = 'agent-2';

export interface TourismRuntime {
  scheduler_ready: boolean;
  last_tick_at: string | null;
  last_error: string;
  provider_agent_id: string | null;
  config_verified_at: string | null;
  transfer_uri: string | null;
  dialed_today: number;
  daily_cap: number;
}

interface Props {
  runtime: TourismRuntime | null;
  runtimeError: string | null;
  onChanged: () => void;
}

type Busy = 'configure' | 'start' | 'pause' | 'test' | null;

export function TourismDialerCard({ runtime, runtimeError, onChanged }: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [importPreview, setImportPreview] = useState<LeadImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [pastedCsv, setPastedCsv] = useState('');

  const run = async (action: string, payload: Record<string, unknown> = {}) => {
    const response = await postStaffFunction('tourism-dialer', { ...payload, action });
    if (!response.ok) {
      const error = await readStaffFunctionError(response);
      return { ok: false as const, error: error.message };
    }
    const body: unknown = await response.json().catch(() => null);
    return { ok: isRecord(body), error: isRecord(body) ? undefined : 'Respuesta no válida.' };
  };

  const withBusy = async (key: Busy, work: () => Promise<{ ok: boolean; error?: string; body?: unknown }>) => {
    setBusy(key);
    setMessage(null);
    try {
      const result = await work();
      if (!result.ok) setMessage({ kind: 'error', text: result.error ?? 'Error' });
      else if (key !== 'pause') setMessage({ kind: 'ok', text: 'Listo.' });
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const importRows = async (rows: string[][]) => {
    setImporting(true);
    setMessage(null);
    try {
      const dncPhones = new Set<string>(await listDoNotCallPhones());
      const preview = parseLeadRows(rows, dncPhones);
      setImportPreview(preview);
      if (preview.tooMany) {
        setMessage({ kind: 'error', text: 'La lista pasa de 500 leads válidos; divídala en dos importaciones.' });
        return;
      }
      if (preview.valid.length === 0) {
        setMessage({ kind: 'error', text: 'No hay números válidos para importar en la lista.' });
        return;
      }
      const campaigns = await listCampaigns();
      let campaign = campaigns.find((entry) => entry.name === TOURISM_CAMPAIGN_NAME);
      if (!campaign) {
        await createCampaign({
          name: TOURISM_CAMPAIGN_NAME,
          purpose: 'Reservas multilingües para negocios de turismo en Costa Rica.',
        });
        campaign = (await listCampaigns()).find((entry) => entry.name === TOURISM_CAMPAIGN_NAME);
      }
      if (!campaign) throw new Error('no se pudo crear la campaña');
      const assigned = await listCampaignAgentIds(campaign.id);
      if (!assigned.includes(TOURISM_AGENT_ID)) {
        await setCampaignAgent(campaign.id, TOURISM_AGENT_ID, true);
      }
      const imported = await importLeads(campaign.id, preview.valid);
      setMessage({
        kind: 'ok',
        text: `Importados ${imported} de ${preview.valid.length} leads nuevos en "${TOURISM_CAMPAIGN_NAME}" (los repetidos se omiten automáticamente).`,
      });
      setPastedCsv('');
      onChanged();
    } catch (error) {
      setMessage({
        kind: 'error',
        text: `No se pudo importar: ${error instanceof Error && error.message ? error.message : 'error inesperado'}.`,
      });
    } finally {
      setImporting(false);
    }
  };

  const onFile = async (file: File) => {
    try {
      await importRows(await readLeadFile(file));
    } catch {
      setMessage({ kind: 'error', text: 'No se pudo leer el archivo CSV.' });
    }
  };

  const onPaste = () => {
    if (!pastedCsv.trim()) {
      setMessage({ kind: 'error', text: 'Pegue el contenido CSV primero.' });
      return;
    }
    void importRows(parseCsvText(pastedCsv));
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Marcador de Turismo</h2>
          <p className="text-sm text-slate-500">
            Campaña &quot;Turismo PLW&quot;: reservas multilingües. Lunes a viernes, 08:00–16:00,
            Costa Rica. Máximo {runtime?.daily_cap ?? 100} llamadas por día, una llamada a la vez
            en la línea compartida.
          </p>
        </div>
        <span
          className={
            runtime?.last_error === 'scheduler_paused'
              ? 'rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800'
              : runtime?.config_verified_at && runtime?.provider_agent_id
                ? 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800'
                : 'rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600'
          }
        >
          {runtime?.last_error === 'scheduler_paused'
            ? 'Pausado'
            : runtime?.config_verified_at && runtime?.provider_agent_id
              ? 'Verificado'
              : 'Sin configurar'}
        </span>
      </header>

      {runtimeError && <p className="mb-3 text-sm text-red-700">{runtimeError}</p>}
      {runtime?.last_error && runtime.last_error !== 'scheduler_paused' && (
        <p className="mb-3 text-sm text-amber-700">{runtime.last_error}</p>
      )}
      {message && (
        <p className={`mb-3 text-sm ${message.kind === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => withBusy('configure', () => run('configure'))}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy === 'configure' ? 'Configurando…' : runtime?.provider_agent_id ? 'Reconfigurar Ana Turismo' : 'Configurar Ana Turismo'}
        </button>
        {runtime?.last_error === 'scheduler_paused' ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => withBusy('start', () => run('control', { state: 'start' }))}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy === 'start' ? 'Activando…' : 'Iniciar'}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy !== null || !runtime?.config_verified_at}
            onClick={() => withBusy('pause', () => run('control', { state: 'pause' }))}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {busy === 'pause' ? 'Pausando…' : 'Pausar'}
          </button>
        )}
        <span className="self-center text-sm text-slate-500">
          Hoy: {runtime?.dialed_today ?? 0}/{runtime?.daily_cap ?? 100} llamadas
        </span>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <label className="block text-sm font-medium text-slate-700" htmlFor="tourism-csv">
          Lista de leads (CSV, hasta 500 por importación)
        </label>
        <input
          id="tourism-csv"
          type="file"
          accept=".csv,.xlsx,.tsv"
          className="mt-1 block text-sm"
          disabled={importing}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        <div className="mt-3">
          <label className="block text-sm font-medium text-slate-700" htmlFor="tourism-csv-paste">
            O pegue el CSV aquí (mismo formato)
          </label>
          <textarea
            id="tourism-csv-paste"
            rows={6}
            value={pastedCsv}
            disabled={importing}
            onChange={(event) => setPastedCsv(event.target.value)}
            placeholder={"Teléfono,Negocio,Contacto,Tipo de negocio\n88887777,Tour Ejemplo,Juan,tours"}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-slate-500 focus:outline-none"
          />
          <button
            type="button"
            disabled={importing}
            onClick={onPaste}
            className="mt-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {importing ? 'Importando…' : 'Importar lo pegado'}
          </button>
        </div>
        {importPreview && (
          <div className="mt-2 text-sm text-slate-600">
            <p>
              Válidos: {importPreview.valid.length} · Duplicados: {importPreview.duplicates} ·
              Bloqueados: {importPreview.doNotCall} · Solo WhatsApp: {importPreview.whatsappOnly} ·
              Inválidos: {importPreview.invalid.length}
            </p>
            {importPreview.tooMany && (
              <p className="text-red-700">La lista pasa de 500 leads válidos; divídala.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
