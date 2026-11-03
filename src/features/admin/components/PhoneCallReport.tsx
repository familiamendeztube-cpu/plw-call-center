import { useEffect, useState } from 'react';
import { callStaffFunction } from '@/integrations/supabase/callStaffFunction';

type CallRecord = {
  linked_id: string; staff_id: string | null; sip_username: string | null;
  direction: string; disposition: string; talk_seconds: number; ended_at: string;
};

export function PhoneCallReport({ agentNames }: { agentNames: Record<string, string> }) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const result = await callStaffFunction('telephony', { action: 'call_report' });
      if (!Array.isArray(result.calls)) throw new Error('Respuesta no válida.');
      setCalls(result.calls as CallRecord[]);
      setTruncated(result.truncated === true);
      setError('');
    } catch {
      setError('No se pudo cargar el reporte telefónico.');
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  // CDR may emit more than one leg: one customer call per linked ID/direction.
  const groups = new Map<string, CallRecord>();
  for (const call of calls) {
    const key = `${call.direction}:${call.linked_id}`;
    const old = groups.get(key);
    if (!old || (call.disposition === 'ANSWERED' && old.disposition !== 'ANSWERED') ||
      (call.disposition === old.disposition && call.talk_seconds > old.talk_seconds)) groups.set(key, call);
  }
  const totals = new Map<string, { inbound: number; outbound: number; answeredOut: number; failedOut: number; seconds: number }>();
  let unansweredInbound = 0;
  for (const call of groups.values()) {
    if (call.direction === 'inbound' && call.disposition !== 'ANSWERED') { unansweredInbound++; continue; }
    const name = call.staff_id ? (agentNames[call.staff_id] ?? call.staff_id) : (call.sip_username ?? 'Sin asignar');
    const row = totals.get(name) ?? { inbound: 0, outbound: 0, answeredOut: 0, failedOut: 0, seconds: 0 };
    if (call.direction === 'inbound') row.inbound++;
    else { row.outbound++; if (call.disposition === 'ANSWERED') row.answeredOut++; else row.failedOut++; }
    row.seconds += call.talk_seconds;
    totals.set(name, row);
  }
  return <section className="rounded-xl border border-neutral-200 bg-white p-4" aria-label="Reporte de llamadas">
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-semibold">Llamadas · últimos 30 días</h2>
      <button className="text-sm underline" onClick={() => void load()} disabled={loading}>Actualizar</button>
    </div>
    <p className="mt-2 text-sm text-neutral-600">Llamadas finalizadas registradas por el servidor. Los intentos entrantes sin respuesta se cuentan en la cola, no contra un agente.</p>
    {error ? <p role="alert" className="mt-3 text-red-700">{error}</p> : loading ? <p>Cargando…</p> : <>
      {truncated && <p role="alert">Reporte parcial: se alcanzó el límite de 10 000 registros.</p>}
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr>{['Agente', 'Entrantes atendidas', 'Salientes', 'Salientes contestadas', 'Salientes sin conexión', 'Minutos hablados'].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead>
        <tbody>{[...totals].map(([name, r]) => <tr key={name}><td className="p-2">{name}</td><td className="p-2">{r.inbound}</td><td className="p-2">{r.outbound}</td><td className="p-2">{r.answeredOut}</td><td className="p-2">{r.failedOut}</td><td className="p-2">{(r.seconds / 60).toFixed(1)}</td></tr>)}</tbody>
      </table></div>
      {!calls.length && <p className="mt-3">Aún no hay registros. Aparecerán después de instalar el puente y finalizar llamadas.</p>}
      <p className="mt-3 text-sm">Entrantes sin respuesta en la cola: {unansweredInbound}</p>
    </>}
  </section>;
}
