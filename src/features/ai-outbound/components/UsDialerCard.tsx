import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { isRecord, postStaffFunction, readStaffFunctionError } from '@/integrations/supabase/callStaffFunction';
import { parseCsvText } from '@/features/ai-outbound/models/outboundLead';
import { readLeadFile } from '@/features/ai-outbound/models/leadFile';
import { getSupabaseClient } from '@/integrations/supabase/client';
import {
  addUsToDnc,
  getUsCampaign,
  importUsLeads,
  listUsLeads,
  prepareUsSample,
  reclassifyUsLeads,
  resolveUsCallback,
  rescheduleUsCallback,
  saveUsSmsConsent,
  type UsLead,
} from '@/features/ai-outbound/services/usCampaign';

export type { UsLead };

export interface UsRuntime {
  scheduler_ready: boolean;
  paused: boolean;
  last_tick_at: string | null;
  last_error: string;
  provider_agent_id: string | null;
  config_verified_at: string | null;
  transfer_uri: string | null;
  caller_e164: string | null;
  dialed_today: number;
  daily_cap: number;
  allowed_from: string;
  allowed_to: string;
}

export interface UsCall {
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

export interface UsSmsMessage {
  id: string;
  lead_id: string;
  to_e164: string;
  body: string;
  web_url: string;
  secretary_url: string;
  status: string;
  created_at: string;
}

export interface UsCallback {
  id: string;
  phone: string;
  scheduled_for: string;
  timezone: string;
  status: string;
  fail_reason: string;
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
  EMAIL_INFO_REQUESTED: 'Pidió correo',
  CALLBACK_REQUESTED: 'Volver a llamar',
  DEMO_SCHEDULED: 'Demo agendada',
  RECEPTIONIST_CONTACT: 'Recepción',
  DECISION_MAKER_UNAVAILABLE: 'Encargado no disponible',
  NOT_INTERESTED: 'No interesado',
  DO_NOT_CALL: 'No llamar',
  WRONG_NUMBER: 'Número equivocado',
  NO_ANSWER: 'No contestó',
  VOICEMAIL: 'Buzón de voz',
  IVR_NO_HUMAN: 'Solo menú automático',
  TECHNICAL_FAILURE: 'Falla técnica',
};

const DEST_LABELS: Record<UsLead['dest'], string> = {
  us: 'EE. UU.',
  ca: 'Canadá',
  cr: 'Costa Rica',
  invalid: 'Inválido',
  other: 'Otro país',
  dup: 'Duplicado',
  dnc: 'No llamar',
};

const usTime = (iso: string, tz = 'America/New_York') =>
  new Date(iso).toLocaleString('es-CR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' });

const crTime = (iso: string) => usTime(iso, 'America/Costa_Rica');

interface Props {
  runtime: UsRuntime | null;
  runtimeError: string | null;
  calls: UsCall[];
  leads: UsLead[];
  callbacks: UsCallback[];
  smsMessages: UsSmsMessage[];
  onChanged: () => void;
}

type Busy = 'configure' | 'start' | 'pause' | 'test' | 'import' | 'classify' | null;

export function UsDialerCard({ runtime, runtimeError, calls, leads, callbacks, smsMessages, onChanged }: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [testPhone, setTestPhone] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pastedCsv, setPastedCsv] = useState('');
  const [imported, setImported] = useState(false);
  const [consentFor, setConsentFor] = useState<UsLead | null>(null);
  const [consentMobile, setConsentMobile] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [sampleFor, setSampleFor] = useState<UsLead | null>(null);
  const [sampleNote, setSampleNote] = useState('');

  const run = async (action: string, payload: Record<string, unknown> = {}) => {
    const response = await postStaffFunction('us-dialer', { ...payload, action });
    if (!response.ok) {
      const error = await readStaffFunctionError(response);
      return { ok: false as const, error: error.message };
    }
    const body: unknown = await response.json().catch(() => null);
    return { ok: isRecord(body), error: isRecord(body) ? undefined : 'Respuesta no válida.' };
  };

  const withBusy = async (key: Busy, work: () => Promise<{ ok: boolean; error?: string }>, okText = 'Listo.') => {
    setBusy(key);
    setMessage(null);
    try {
      const result = await work();
      if (!result.ok) setMessage({ kind: 'error', text: result.error ?? 'Error' });
      else if (key !== 'pause') setMessage({ kind: 'ok', text: okText });
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const importRows = async (rows: string[][]) => {
    setBusy('import');
    setMessage(null);
    try {
      // Columns: teléfono, negocio, contacto, tipo, referencia de inscripción (opcional).
      const header = (rows[0] ?? []).map((cell) => cell.trim().toLowerCase());
      const hasHeader = header.some((cell) => /tel/.test(cell));
      const dataRows = hasHeader ? rows.slice(1) : rows;
      const draft = dataRows
        .filter((cells) => cells.some((cell) => cell.trim()))
        .map((cells) => ({
          raw_phone: (cells[0] ?? '').trim(),
          business_name: (cells[1] ?? '').trim().slice(0, 160),
          contact_name: (cells[2] ?? '').trim().slice(0, 120),
          business_type: (cells[3] ?? '').trim().slice(0, 120),
          consent_ref: (cells[4] ?? '').trim().slice(0, 240),
        }))
        .filter((row) => row.raw_phone !== '');
      if (draft.length === 0) {
        setMessage({ kind: 'error', text: 'No hay filas con teléfono en la lista.' });
        return;
      }
      if (draft.length > 500) {
        setMessage({ kind: 'error', text: 'La lista pasa de 500 filas; divídala en dos importaciones.' });
        return;
      }
      let campaign = await getUsCampaign();
      if (!campaign) {
        setMessage({ kind: 'error', text: 'Falta la campaña de EE. UU. en la base de datos.' });
        return;
      }
      const inserted = await importUsLeads(campaign.id, draft);
      const classified = await reclassifyUsLeads(campaign.id);
      setMessage({
        kind: 'ok',
        text: `Registradas ${inserted} filas nuevas; clasificación actualizada (${classified} revisadas). Revise la tabla: Costa Rica, inválidos y repetidos quedan visibles fuera de cola.`,
      });
      setPastedCsv('');
      setImported(true);
      onChanged();
    } catch (error) {
      setMessage({ kind: 'error', text: `No se pudo importar: ${error instanceof Error ? error.message : 'error inesperado'}.` });
    } finally {
      setBusy(null);
    }
  };

  const doReclassify = async () => {
    setBusy('classify');
    setMessage(null);
    try {
      const campaign = await getUsCampaign();
      if (!campaign) {
        setMessage({ kind: 'error', text: 'Falta la campaña de EE. UU. en la base de datos.' });
        return;
      }
      const classified = await reclassifyUsLeads(campaign.id);
      setMessage({ kind: 'ok', text: `Clasificación actualizada (${classified} filas revisadas).` });
      onChanged();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Error' });
    } finally {
      setBusy(null);
    }
  };

  const openConsent = (lead: UsLead) => {
    setConsentFor(lead);
    setConsentMobile(lead.sms_mobile ?? '');
    setConsentChecked(lead.sms_consent);
    setMessage(null);
  };

  const saveConsent = async () => {
    if (!consentFor) return;
    setBusy('test');
    setMessage(null);
    try {
      await saveUsSmsConsent(consentFor.id, consentMobile.trim(), consentChecked);
      setMessage({ kind: 'ok', text: consentChecked ? 'Permiso de SMS guardado.' : 'SMS suprimido para este contacto.' });
      setConsentFor(null);
      onChanged();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Error' });
    } finally {
      setBusy(null);
    }
  };

  const prepareSample = async (lead: UsLead) => {
    setSampleFor(lead);
    setSampleNote('');
    setMessage(null);
    try {
      const { data: prospect } = await getSupabaseClient()
        .from('prospects')
        .select('id')
        .eq('idempotency_key', `us:${lead.id}`)
        .maybeSingle();
      if (!prospect) {
        setMessage({ kind: 'error', text: 'La muestra se prepara solo después de una llamada humana con interés confirmado.' });
        return;
      }
      const result = await prepareUsSample(prospect.id);
      setMessage({
        kind: 'ok',
        text: result.reused
          ? 'Muestra ya existente: se reutilizó el mismo borrador y enlace.'
          : 'Muestra lista: borrador y enlace creados. Compártala solo cuando el cliente la pida.',
      });
      setSampleNote(result.preview_token);
      onChanged();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Error' });
    }
  };

  const sendSms = async (lead: UsLead) => {
    setBusy('test');
    setMessage(null);
    try {
      const { data: prospect } = await getSupabaseClient()
        .from('prospects')
        .select('id')
        .eq('idempotency_key', `us:${lead.id}`)
        .maybeSingle();
      const { data: draft } = await getSupabaseClient()
        .from('prospect_site_drafts')
        .select('preview_token')
        .eq('prospect_id', prospect?.id ?? '')
        .maybeSingle();
      if (!draft) {
        setMessage({ kind: 'error', text: 'Primero prepare la muestra; el SMS lleva sus dos enlaces.' });
        return;
      }
      const base = `${window.location.origin}/demo-hotel/plw-${draft.preview_token}`;
      const response = await postStaffFunction('us-sms', {
        action: 'send',
        leadId: lead.id,
        idempotencyKey: `sms-${lead.id}-${draft.preview_token.slice(0, 12)}`,
        body: `Professional Latino Workers: vea la muestra para su negocio: ${base} y hable con nuestra asistente: ${base}?voice=1. Responda STOP para no recibir más mensajes.`,
        webUrl: base,
        secretaryUrl: `${base}?voice=1`,
      });
      if (!response.ok) {
        const error = await readStaffFunctionError(response);
        setMessage({ kind: 'error', text: error.message });
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (isRecord(body) && body.status === 'suppressed')
        setMessage({ kind: 'error', text: 'Este contacto no tiene permiso de SMS guardado; el mensaje quedó suprimido, no enviado.' });
      else if (isRecord(body) && body.reused)
        setMessage({ kind: 'ok', text: 'Este mensaje ya se había enviado; no se duplicó.' });
      else
        setMessage({ kind: 'ok', text: 'SMS enviado con los dos enlaces.' });
      onChanged();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Error' });
    } finally {
      setBusy(null);
    }
  };

  const verified = Boolean(runtime?.config_verified_at && runtime?.provider_agent_id && runtime?.transfer_uri);
  const paused = runtime?.paused !== false;
  const status = !verified ? 'Sin configurar' : paused ? 'Pausado' : 'Marcando';
  const queueLeads = leads.filter((lead) => lead.dest === 'us');
  const outsideLeads = leads.filter((lead) => lead.dest !== 'us');

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-neutral-200 bg-white p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-plw-ink">Marcador EE. UU. · Negocios en español</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Anna llama de lunes a viernes, {runtime?.allowed_from ?? '08:00'}–{runtime?.allowed_to ?? '16:00'} hora local de
            cada negocio (zona horaria propia, con horario de verano). Máximo {runtime?.daily_cap ?? 100} llamadas por día,
            una a la vez en la línea compartida. Remitente: {runtime?.caller_e164 ?? 'número pendiente de configurar'}.
          </p>
        </div>
        <Badge tone={status === 'Marcando' ? 'success' : status === 'Pausado' ? 'warning' : 'neutral'}>
          {status}
        </Badge>
      </header>

      {runtimeError && <p role="alert" className="text-sm text-danger-700">{runtimeError}</p>}
      {runtime?.last_error && <p className="text-sm text-warning-700">{runtime.last_error}</p>}
      {message && (
        <p className={`text-sm ${message.kind === 'ok' ? 'text-success-700' : 'text-danger-700'}`}>{message.text}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy !== null} onClick={() => void withBusy('configure', () => run('configure'))}>
          {busy === 'configure' ? 'Configurando…' : runtime?.provider_agent_id ? 'Reconfigurar Anna EE. UU.' : 'Configurar Anna EE. UU.'}
        </Button>
        {paused ? (
          <Button variant="success" disabled={busy !== null || !verified} onClick={() => void withBusy('start', () => run('control', { state: 'start' }))}>
            {busy === 'start' ? 'Activando…' : 'Iniciar'}
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy !== null} onClick={() => void withBusy('pause', () => run('control', { state: 'pause' }), 'Pausado.')}>
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
          label="Llamada de prueba con Anna EE. UU."
          type="tel"
          inputMode="tel"
          value={testPhone}
          onChange={(event) => setTestPhone(event.target.value)}
          placeholder="305 555 1234"
          className="w-48"
        />
        <Button type="submit" variant="secondary" disabled={busy !== null || !verified || testPhone.trim() === ''}>
          {busy === 'test' ? 'Llamando…' : 'Llamar'}
        </Button>
        <span className="basis-full text-xs text-neutral-500">
          Funciona aunque el marcador esté pausado; no cuenta en el límite diario. Usa un número de EE. UU. de 10 dígitos.
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
                  <span className="text-neutral-500">{call.phone} · {crTime(call.created_at)}</span>
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
        <h3 className="text-sm font-medium text-neutral-700">Devoluciones prometidas</h3>
        {callbacks.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-500">Todavía no hay devoluciones.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-200 text-sm">
            {callbacks.map((callback) => (
              <li key={callback.id} className="flex flex-wrap items-baseline gap-x-2 py-2">
                <span className="font-medium text-plw-ink">{callback.lead?.business_name || 'Sin nombre'}</span>
                <span className="text-neutral-500">
                  {callback.phone} · {usTime(callback.scheduled_for, callback.timezone)} ({callback.timezone})
                </span>
                <span className="ml-auto">
                  <Badge tone={callback.status === 'pending' ? 'warning' : callback.status === 'done' ? 'success' : 'neutral'}>
                    {callback.status === 'pending' ? 'Pendiente' : callback.status === 'done' ? 'Hecha' : callback.status}
                  </Badge>
                </span>
                {callback.status === 'pending' ? (
                  <form
                    className="flex w-full flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      const slot = String(data.get('slot') ?? '');
                      setBusy('test');
                      (slot
                        ? rescheduleUsCallback(callback.id, new Date(slot).toISOString())
                        : resolveUsCallback(callback.id, 'done')
                      )
                        .then(() => {
                          setMessage({ kind: 'ok', text: slot ? 'Devolución reagendada.' : 'Devolución resuelta.' });
                          onChanged();
                        })
                        .catch((error) => setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Error' }))
                        .finally(() => setBusy(null));
                    }}
                  >
                    <input name="slot" type="datetime-local" className="w-52 rounded-lg border border-neutral-300 px-2 py-1 text-xs text-plw-ink" />
                    <Button type="submit" size="sm" variant="secondary" disabled={busy !== null}>
                      Guardar
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-neutral-200 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-neutral-700">
            Cola de marcación ({queueLeads.length})
          </h3>
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void doReclassify()}>
            {busy === 'classify' ? 'Clasificando…' : 'Reclasificar lista'}
          </Button>
        </div>
        {queueLeads.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-500">Sin contactos de EE. UU. válidos todavía.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-200 text-sm">
            {queueLeads.slice(0, 50).map((lead) => (
              <li key={lead.id} className="flex flex-wrap items-baseline gap-x-2 py-2">
                <span className="font-medium text-plw-ink">{lead.business_name || 'Sin nombre'}</span>
                <span className="text-neutral-500">{lead.phone_e164} · {lead.timezone}</span>
                {lead.sms_consent ? <Badge tone="success">SMS ok</Badge> : null}
                <span className="ml-auto flex gap-2">
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => openConsent(lead)}>
                    Permiso SMS
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void sendSms(lead)}>
                    {busy === 'test' ? 'Enviando…' : 'Enviar por SMS'}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void prepareSample(lead)}>
                    Preparar muestra
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => {
                      setBusy('test');
                      addUsToDnc(lead.phone_e164 ?? '', lead.id)
                        .then(() => {
                          setMessage({ kind: 'ok', text: 'Número marcado como no llamar.' });
                          onChanged();
                        })
                        .catch((error) => setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Error' }))
                        .finally(() => setBusy(null));
                    }}
                  >
                    No llamar
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {outsideLeads.length > 0 && (
        <div className="border-t border-neutral-200 pt-5">
          <h3 className="text-sm font-medium text-neutral-700">
            Fuera de cola ({outsideLeads.length}): Costa Rica, inválidos, repetidos y no llamar quedan visibles, sin borrar
          </h3>
          <ul className="mt-2 divide-y divide-neutral-200 text-sm">
            {outsideLeads.slice(0, 50).map((lead) => (
              <li key={lead.id} className="flex flex-wrap items-baseline gap-x-2 py-2">
                <Badge tone={lead.dest === 'cr' ? 'warning' : 'neutral'}>{DEST_LABELS[lead.dest]}</Badge>
                <span className="font-medium text-plw-ink">{lead.business_name || 'Sin nombre'}</span>
                <span className="text-neutral-500">{lead.phone_e164 ?? lead.raw_phone}</span>
                <span className="ml-auto text-xs text-neutral-500">{lead.excluded_reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {smsMessages.length > 0 && (
        <div className="border-t border-neutral-200 pt-5">
          <h3 className="text-sm font-medium text-neutral-700">Mensajes SMS</h3>
          <ul className="mt-2 divide-y divide-neutral-200 text-sm">
            {smsMessages.map((sms) => (
              <li key={sms.id} className="py-2">
                <span className="text-neutral-500">{sms.to_e164} · {crTime(sms.created_at)} · </span>
                <Badge tone={sms.status === 'delivered' ? 'success' : sms.status === 'failed' || sms.status === 'suppressed' ? 'danger' : 'warning'}>
                  {sms.status}
                </Badge>
                <p className="line-clamp-2 text-neutral-600">{sms.body}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {consentFor && (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <h3 className="text-sm font-semibold text-plw-ink">Permiso de SMS · {consentFor.business_name || 'Sin nombre'}</h3>
          <p className="mt-1 text-xs text-neutral-600">
            El móvil autorizado para SMS puede ser distinto del teléfono principal. El permiso de SMS es separado del permiso
            de llamada; sin él, los mensajes quedan suprimidos.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <TextField label="Móvil autorizado (EE. UU.)" value={consentMobile} onChange={(event) => setConsentMobile(event.target.value)} placeholder="305 555 1234" className="w-48" />
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} />
              El cliente aceptó recibir SMS
            </label>
            <Button variant="secondary" disabled={busy !== null} onClick={() => void saveConsent()}>
              Guardar
            </Button>
            <Button variant="ghost" onClick={() => setConsentFor(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <div className="border-t border-neutral-200 pt-5">
        <label className="block text-sm font-medium text-neutral-700" htmlFor="us-csv">
          Lista de leads EE. UU. (CSV, hasta 500 por importación; columnas: teléfono, negocio, contacto, tipo, referencia de inscripción)
        </label>
        <input
          id="us-csv"
          type="file"
          accept=".csv,.xlsx,.tsv"
          className="mt-2 block text-sm text-neutral-700 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-2 file:text-plw-ink"
          disabled={busy !== null}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            readLeadFile(file)
              .then((rows) => void importRows(rows))
              .catch(() => setMessage({ kind: 'error', text: 'No se pudo leer el archivo CSV.' }));
          }}
        />
        <div className="mt-4">
          <label className="block text-sm font-medium text-neutral-700" htmlFor="us-csv-paste">
            O pegue el CSV aquí (mismo formato)
          </label>
          <textarea
            id="us-csv-paste"
            rows={6}
            value={pastedCsv}
            disabled={busy !== null}
            onChange={(event) => setPastedCsv(event.target.value)}
            placeholder={'Teléfono,Negocio,Contacto,Tipo de negocio,Referencia de inscripción\n+1 305 555 1234,Restaurante Ejemplo,Juan,restaurante,acuerdo 2026-06'}
            className="mt-1.5 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm text-plw-ink transition-colors duration-150 placeholder:text-neutral-400 hover:border-neutral-400 focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30"
          />
          <Button variant="secondary" className="mt-3" disabled={busy !== null} onClick={() => void importRows(parseCsvText(pastedCsv))}>
            {busy === 'import' ? 'Importando…' : 'Importar lo pegado'}
          </Button>
          {imported && (
            <p className="mt-2 text-xs text-neutral-500">
              La importación no crea muestras: la muestra se prepara solo tras una llamada humana con interés confirmado.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
