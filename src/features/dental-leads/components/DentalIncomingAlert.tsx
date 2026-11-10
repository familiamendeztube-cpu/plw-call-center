import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/context/useAuth';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { useIncomingDentalCall } from '../hooks/useIncomingDentalCall';
import { incomingDentalView } from '../models/incomingDentalCall';

export function DentalIncomingAlert() {
  const { session } = useAuth();
  const { call, answerCall, hangUp } = useTelephony();
  const agentId = session?.role === 'agent' ? session.agentId : null;
  const lookup = useIncomingDentalCall(call, agentId);
  const view = incomingDentalView(call, agentId, lookup ?? { status: 'loading' });
  if (view.kind === 'hidden') return null;

  return (
    <section
      role="alertdialog"
      aria-live="assertive"
      aria-label="Llamada dental entrante"
      className="fixed inset-x-4 top-4 z-50 mx-auto grid max-w-2xl gap-4 rounded-2xl border-2 border-plw-navy bg-white p-6 shadow-2xl"
    >
      <p className="text-sm font-semibold uppercase tracking-wide text-plw-navy">
        Llamada dental entrante
      </p>
      {view.kind === 'loading' && (
        <p role="status" className="text-lg text-neutral-700">
          Cargando los datos del dentista…
        </p>
      )}
      {view.kind === 'unknown' && (
        <p role="alert" className="text-lg text-danger-700">
          {view.reason}
        </p>
      )}
      {view.kind === 'ready' && (
        <div className="grid gap-3">
          <h2 className="text-2xl font-semibold text-plw-navy">
            {view.lead?.business_name ?? 'Dentista sin nombre registrado'}
          </h2>
          <dl className="grid gap-2 text-base sm:grid-cols-2">
            <div>
              <dt className="text-sm text-neutral-500">Teléfono del dentista</dt>
              <dd className="font-semibold">+506 {view.call.phone}</dd>
            </div>
            <div>
              <dt className="text-sm text-neutral-500">Agente asignado</dt>
              <dd className="font-semibold">{session?.displayName ?? 'Su usuario'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm text-neutral-500">Ubicación</dt>
              <dd className="font-semibold">
                {[view.lead?.address, view.lead?.canton, view.lead?.province]
                  .filter(Boolean)
                  .join(', ') || 'Ubicación no registrada'}
              </dd>
            </div>
          </dl>
          <div className="rounded-lg bg-plw-ivory p-3 text-sm">
            <p className="mb-1 font-semibold">Resumen de Ana</p>
            <p className="whitespace-pre-wrap">
              {view.call.summary?.trim() || 'Resumen todavía no disponible.'}
            </p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="success" onClick={() => void answerCall()}>
          Contestar
        </Button>
        <Button variant="danger" onClick={() => void hangUp()}>
          Rechazar
        </Button>
        <Link
          to="/llamadas-dentales"
          className="ml-auto text-sm font-semibold text-plw-navy underline underline-offset-4"
        >
          Ver detalle
        </Link>
      </div>
    </section>
  );
}
