import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/context/useAuth';
import {
  CALL_STATE,
  TRANSFER_STATE,
  type DentalCall,
  type DentalTranscript,
} from '../models/dentalDialer';
import { confirmTransfer, loadTranscript } from '../services/dentalDialer';
export function DentalCallHistory({ calls, reload }: { calls: DentalCall[]; reload: () => void }) {
  const { session } = useAuth();
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(() => searchParams.get('call'));
  const [detail, setDetail] = useState<DentalTranscript | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(25);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDetail(null);
    setError('');
    let loading = false;
    async function update() {
      if (loading) return;
      loading = true;
      try {
        const d = await loadTranscript(selected!, controller.signal);
        if (!controller.signal.aborted) {
          setDetail(d);
          setError('');
        }
      } catch {
        if (!controller.signal.aborted)
          setError('No se pudo cargar la transcripción. Se intentará de nuevo.');
      } finally {
        loading = false;
      }
    }
    void update();
    const timer = window.setInterval(() => void update(), 15000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [selected]);
  async function confirm(id: string) {
    setBusy(true);
    setError('');
    try {
      await confirmTransfer(id);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo confirmar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="grid gap-3" aria-label="Historial de llamadas dentales">
      <h2 className="text-lg font-semibold text-plw-navy">
        Llamadas, transferencias y transcripciones
      </h2>
      {error && (
        <p role="alert" className="text-danger-700">
          {error}
        </p>
      )}
      {!calls.length && (
        <p className="rounded-xl border bg-white p-5 text-sm text-neutral-600">
          Todavía no hay llamadas dentales registradas.
        </p>
      )}
      {calls.slice(0, limit).map((call) => (
        <article key={call.id} className="rounded-xl border bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">
                +506 {call.phone} {call.is_test ? '· Prueba' : ''}
              </p>
              <p className="mt-1 text-sm">
                {CALL_STATE[call.state]} · Transferencia: {TRANSFER_STATE[call.transfer_status]}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                {new Date(call.created_at).toLocaleString('es-CR', {
                  timeZone: 'America/Costa_Rica',
                })}
              </p>
              {call.error && <p className="mt-2 text-sm text-danger-700">{call.error}</p>}
            </div>
            <Button
              variant="secondary"
              onClick={() => setSelected(selected === call.id ? null : call.id)}
              aria-expanded={selected === call.id}
            >
              Ver transcripción
            </Button>
          </div>
          {session?.role === 'agent' &&
            call.staff_id === session.agentId &&
            call.transfer_status === 'requested' && (
              <Button className="mt-3" disabled={busy} onClick={() => void confirm(call.id)}>
                Recibí esta transferencia
              </Button>
            )}
          {selected === call.id && (
            <div className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto border-t pt-4">
              {!detail ? (
                <p role="status">
                  {error
                    ? 'Transcripción no disponible por el momento.'
                    : 'Cargando transcripción…'}
                </p>
              ) : (
                <>
                  {detail.summary && (
                    <p className="rounded-lg bg-plw-ivory p-3 text-sm">{detail.summary}</p>
                  )}
                  {!detail.transcript.length && (
                    <p className="text-sm text-neutral-500">
                      El proveedor todavía no ha entregado la transcripción.
                    </p>
                  )}
                  {detail.transcript.map((line, i) => (
                    <div key={i} className="rounded-lg bg-neutral-50 p-3 text-sm">
                      <p className="mb-1 font-semibold">
                        {line.role === 'agent' ? 'Ana' : 'Persona llamada'} ·{' '}
                        {Math.floor(line.time_in_call_secs)} s
                      </p>
                      <p className="whitespace-pre-wrap">{line.message}</p>
                      {line.tools?.length > 0 && (
                        <p className="mt-1 text-xs text-neutral-500">
                          Acción: {line.tools.join(', ')}
                        </p>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </article>
      ))}
      {calls.length > limit && (
        <Button variant="secondary" onClick={() => setLimit((v) => v + 25)}>
          Mostrar más llamadas
        </Button>
      )}
    </section>
  );
}
