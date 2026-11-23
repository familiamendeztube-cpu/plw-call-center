import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { isRecord, postStaffFunction, readStaffFunctionError } from '@/integrations/supabase/callStaffFunction';
import { parseCsvText, parseLeadRows } from '@/features/ai-outbound/models/outboundLead';
import { readLeadFile } from '@/features/ai-outbound/models/leadFile';
import { type TourismPromise, type TourismAlert } from '@/features/ai-outbound/services/tourismPromises';
import {
  createCampaign,
  importLeads,
  listCampaignAgentIds,
  listCampaigns,
  listDoNotCallPhones,
  setCampaignAgent,
} from '@/features/ai-outbound/services/outboundCampaigns';
import type { LeadImportPreview, OutboundLeadDraft } from '@/features/ai-outbound/models/outboundLead';

const TOURISM_CAMPAIGN_NAME = 'Turismo PLW';
export const TOURISM_AGENT_ID = 'agent-2';

export interface TourismRuntime {
  scheduler_ready: boolean;
  /** Only Iniciar clears it; Configurar never starts dialing. */
  paused: boolean;
  last_tick_at: string | null;
  last_error: string;
  provider_agent_id: string | null;
  config_verified_at: string | null;
  transfer_uri: string | null;
  dialed_today: number;
  daily_cap: number;
}

export interface TourismCall {
  id: string;
  created_at: string;
  phone: string;
  state: string;
  outcome: string | null;
  summary: string;
  error: string;
  is_test: boolean;
  lead: { business_name: string } | null;
}

const STATE_LABELS: Record<string, string> = {
  reserved: 'Reservada',
  started: 'En curso',
  uncertain: 'Sin confirmar',
  completed: 'Terminada',
  failed: 'Fallida',
  cancelled: 'Cancelada',
};

const OUTCOME_LABELS: Record<string, string> = {
  APPOINTMENT_CONFIRMED: 'Cita confirmada',
  INTERESTED_FOLLOW_UP: 'Interesado',
  WHATSAPP_INFO_REQUESTED: 'Pidió WhatsApp',
  EMAIL_INFO_REQUESTED: 'Pidió correo',
  CALLBACK_REQUESTED: 'Volver a llamar',
  RECEPTIONIST_CONTACT: 'Recepción',
  DECISION_MAKER_UNAVAILABLE: 'Encargado no disponible',
  NOT_INTERESTED: 'No interesado',
  DO_NOT_CALL: 'No llamar',
  WRONG_NUMBER: 'Número equivocado',
  NO_ANSWER: 'No contestó',
  VOICEMAIL: 'Buzón de voz',
  TECHNICAL_FAILURE: 'Falla técnica',
};

const crTime = (iso: string) =>
  new Date(iso).toLocaleString('es-CR', {
    timeZone: 'America/Costa_Rica',
    dateStyle: 'short',
    timeStyle: 'short',
  });

interface Props {
  runtime: TourismRuntime | null;
  runtimeError: string | null;
  calls: TourismCall[];
  onChanged: () => void;
  promises?: TourismPromise[];
  alerts?: TourismAlert[];
  onResolve?: (id: string, note: string) => Promise<void>;
  onReschedule?: (id: string, slot: string, note: string) => Promise<void>;
  onRestart?: () => Promise<void>;
}

type Busy = 'configure' | 'start' | 'pause' | 'test' | null;

export function TourismDialerCard({ runtime, runtimeError, calls, onChanged, promises = [], alerts = [], onResolve, onReschedule, onRestart }: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [testPhone, setTestPhone] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [importPreview, setImportPreview] = useState<LeadImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [pastedCsv, setPastedCsv] = useState('');
  const [acting, setActing] = useState<string | null>(null);

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
      const imported = await importLeads(
        campaign.id,
        // channel is a CSV-only routing hint (WhatsApp-only skip); the leads table has no such column.
        preview.valid.map((lead): OutboundLeadDraft => ({ ...lead, channel: '' }))
      );
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

  const verified = Boolean(runtime?.config_verified_at && runtime?.provider_agent_id);
  const paused = runtime?.paused !== false;
  const status = !verified ? 'Sin configurar' : paused ? 'Pausado' : 'Marcando';

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-neutral-200 bg-white p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-plw-ink">Marcador de Turismo</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Campaña &quot;Turismo PLW&quot;: reservas multilingües. Lunes a viernes, 08:00–16:00,
            Costa Rica. Máximo {runtime?.daily_cap ?? 100} llamadas por día, una llamada a la vez
            en la línea compartida.
          </p>
        </div>
        <Badge tone={status === 'Marcando' ? 'success' : status === 'Pausado' ? 'warning' : 'neutral'}>
          {status}
        </Badge>
      </header>

      {runtimeError && <p role="alert" className="text-sm text-danger-700">{runtimeError}</p>}
      {runtime?.last_error && runtime.last_error !== 'scheduler_paused' && (
        <p className="text-sm text-warning-700">{runtime.last_error}</p>
      )}
      {message && (
        <p className={`text-sm ${message.kind === 'ok' ? 'text-success-700' : 'text-danger-700'}`}>
          {message.text}
        </p>
      )}

      {alerts.filter((alert) => !alert.cleared_at).length > 0 && (
        <div role="alert" className="rounded-xl border border-danger-200 bg-danger-50 p-4">
          {alerts.filter((alert) => !alert.cleared_at).map((alert) => (
            <div key={alert.id} className="flex flex-col gap-2">
              <p className="text-sm font-medium text-danger-700">{alert.reason}</p>
              <ul className="list-disc pl-5 text-xs text-danger-700">
                {(alert.evidence?.calls ?? []).map((entry, index) => (
                  <li key={index}>
                    {entry.business || 'Sin nombre'} · {entry.phone} · {crTime(entry.at ?? alert.created_at)}
                    {entry.error ? ` — ${entry.error}` : ''}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-neutral-600">
                La pausa persiste aunque recargue o pase el scheduler; solo un reinicio autorizado la
                registra. Iniciar sigue siendo el único botón que marca.
              </p>
              {onRestart ? (
                <Button
                  variant="secondary"
                  className="self-start"
                  disabled={acting !== null}
                  onClick={() => {
                    setActing('restart');
                    onRestart()
                      .then(() => {
                        setMessage({ kind: 'ok', text: 'Alerta registrada como revisada. Recuerde: Iniciar es el único botón que marca.' });
                        onChanged();
                      })
                      .catch((error) => setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Error' }))
                      .finally(() => setActing(null));
                  }}
                >
                  {acting === 'restart' ? 'Registrando…' : 'Registrar reinicio autorizado'}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {promises.length > 0 && (
        <div className="rounded-xl border border-warning-200 bg-warning-50 p-4">
          <h3 className="text-sm font-semibold text-warning-700">Devoluciones prometidas</h3>
          <p className="mt-0.5 text-xs text-warning-700">
            Arriba: promesas incumplidas que Alejandro debe atender; abajo: las pendientes.
          </p>
          <ul className="mt-2 divide-y divide-warning-200 text-sm">
            {promises.map((promise) => (
              <li key={promise.id} className="flex flex-col gap-1 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-plw-ink">{promise.business || 'Sin nombre'}</span>
                  <span className="text-neutral-500">{promise.phone}</span>
                  <span className="ml-auto">
                    {promise.status === 'failed' ? (
                      <Badge tone="danger">Incumplida</Badge>
                    ) : (
                      <Badge tone="warning">Pendiente</Badge>
                    )}
                  </span>
                </div>
                <p className="text-xs text-neutral-600">
                  Prometido: {crTime(promise.scheduled_for)} (hora de Costa Rica)
                  {promise.resolved_at ? ' · resuelto' : ''}
                </p>
                {promise.fail_reason && <p className="text-xs text-danger-700">{promise.fail_reason}</p>}
                {promise.status === 'failed' && onResolve && onReschedule && !promise.resolved_at && (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      const note = String(data.get('note') ?? '');
                      const slot = String(data.get('slot') ?? '');
                      setActing(promise.id);
                      (slot ? onReschedule(promise.id, slot, note) : onResolve(promise.id, note))
                        .then(() => {
                          setMessage({ kind: 'ok', text: slot ? 'Promesa reagendada.' : 'Promesa resuelta.' });
                          onChanged();
                        })
                        .catch((error) => setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Error' }))
                        .finally(() => setActing(null));
                    }}
                  >
                    <input
                      name="note"
                      placeholder="Nota de resolución (opcional)"
                      className="w-52 rounded-lg border border-neutral-300 px-2 py-1 text-xs text-plw-ink"
                    />
                    <input
                      name="slot"
                      type="datetime-local"
                      className="w-52 rounded-lg border border-neutral-300 px-2 py-1 text-xs text-plw-ink"
                    />
                    <Button type="submit" size="sm" variant="secondary" disabled={acting !== null}>
                      {acting === promise.id ? 'Guardando…' : 'Resolver'}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy !== null} onClick={() => withBusy('configure', () => run('configure'))}>
          {busy === 'configure' ? 'Configurando…' : runtime?.provider_agent_id ? 'Reconfigurar Ana Turismo' : 'Configurar Ana Turismo'}
        </Button>
        {paused ? (
          <Button
            variant="success"
            disabled={busy !== null || !verified}
            onClick={() => withBusy('start', () => run('control', { state: 'start' }))}
          >
            {busy === 'start' ? 'Activando…' : 'Iniciar'}
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => withBusy('pause', () => run('control', { state: 'pause' }))}
          >
            {busy === 'pause' ? 'Pausando…' : 'Pausar'}
          </Button>
        )}
        <span className="text-sm text-neutral-500">
          Hoy: {runtime?.dialed_today ?? 0}/{runtime?.daily_cap ?? 100} llamadas
        </span>
      </div>

      <form
        className="flex flex-wrap items-end gap-3 border-t border-neutral-200 pt-5"
        onSubmit={(event) => {
          event.preventDefault();
          void withBusy('test', () => run('test', { phone: testPhone, requestId: crypto.randomUUID() }));
        }}
      >
        <TextField
          label="Llamada de prueba con Anna Turismo"
          type="tel"
          inputMode="tel"
          value={testPhone}
          onChange={(event) => setTestPhone(event.target.value)}
          placeholder="8888 7777"
          className="w-48"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={busy !== null || !verified || testPhone.trim() === ''}
        >
          {busy === 'test' ? 'Llamando…' : 'Llamar'}
        </Button>
        <span className="basis-full text-xs text-neutral-500">
          Funciona aunque el marcador esté pausado; no cuenta en el límite diario.
        </span>
      </form>

      <div className="border-t border-neutral-200 pt-5">
        <h3 className="text-sm font-medium text-neutral-700">Últimas llamadas</h3>
        {calls.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-500">Todavía no hay llamadas.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-200 text-sm">
            {calls.map((call) => (
              <li key={call.id} className="grid gap-0.5 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-plw-ink">
                    {call.is_test ? 'Prueba' : call.lead?.business_name || 'Sin nombre'}
                  </span>
                  <span className="text-neutral-500">
                    {call.phone} · {crTime(call.created_at)}
                  </span>
                  <span className="ml-auto text-neutral-700">
                    {call.outcome ? (OUTCOME_LABELS[call.outcome] ?? call.outcome) : (STATE_LABELS[call.state] ?? call.state)}
                  </span>
                </div>
                {call.summary || call.error ? (
                  <p className="line-clamp-2 text-neutral-600">{call.summary || call.error}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-neutral-200 pt-5">
        <label className="block text-sm font-medium text-neutral-700" htmlFor="tourism-csv">
          Lista de leads (CSV, hasta 500 por importación)
        </label>
        <input
          id="tourism-csv"
          type="file"
          accept=".csv,.xlsx,.tsv"
          className="mt-2 block text-sm text-neutral-700 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-2 file:text-plw-ink"
          disabled={importing}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        <div className="mt-4">
          <label className="block text-sm font-medium text-neutral-700" htmlFor="tourism-csv-paste">
            O pegue el CSV aquí (mismo formato)
          </label>
          <textarea
            id="tourism-csv-paste"
            rows={6}
            value={pastedCsv}
            disabled={importing}
            onChange={(event) => setPastedCsv(event.target.value)}
            placeholder={"Teléfono,Negocio,Contacto,Tipo de negocio\n88887777,Tour Ejemplo,Juan,tours"}
            className="mt-1.5 block w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-sm text-plw-ink transition-colors duration-150 placeholder:text-neutral-400 hover:border-white/20 focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30"
          />
          <Button variant="secondary" className="mt-3" disabled={importing} onClick={onPaste}>
            {importing ? 'Importando…' : 'Importar lo pegado'}
          </Button>
        </div>
        {importPreview && (
          <div className="mt-3 text-sm text-neutral-600">
            <p>
              Válidos: {importPreview.valid.length} · Duplicados: {importPreview.duplicates} ·
              Bloqueados: {importPreview.doNotCall} · Solo WhatsApp: {importPreview.whatsappOnly} ·
              Inválidos: {importPreview.invalid.length}
            </p>
            {importPreview.tooMany && (
              <p className="text-danger-700">La lista pasa de 500 leads válidos; divídala.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
