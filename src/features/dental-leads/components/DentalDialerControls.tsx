import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { controlDialer, dentalServerAction } from '../services/dentalDialer';
import { dialerReady, type DentalDialer, type DentalRuntime } from '../models/dentalDialer';
export function DentalDialerControls({
  route,
  runtime,
  reload,
  pilotAttempts = 0,
}: {
  route: DentalDialer;
  runtime: DentalRuntime | null;
  reload: () => void;
  pilotAttempts?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  async function run(action: string) {
    setBusy(true);
    setMessage('');
    try {
      if (['configure', 'test', 'sync'].includes(action))
        await dentalServerAction({ action, staffId: route.staff_id, phone, requestId });
      else await controlDialer(route.staff_id, action);
      setMessage(
        action === 'test'
          ? 'Prueba registrada. Compruebe el resultado en el historial.'
          : action === 'configure'
            ? route.pilot_call_limit
              ? 'Ana configurada. Espere la señal del servidor para activar el piloto.'
              : 'Voz configurada. Haga una prueba de transferencia.'
            : 'Acción guardada.'
      );
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudo completar.');
    } finally {
      setBusy(false);
    }
  }
  const ready = dialerReady(route, runtime);
  const pilot = Boolean(
    route.pilot_call_limit && route.pilot_call_limit >= 1 && route.pilot_call_limit <= 20
  );
  const exhausted = pilot && pilotAttempts >= (route.pilot_call_limit ?? 0);
  return (
    <section
      className="grid gap-4 rounded-xl border bg-white p-5"
      aria-label="Control del marcador"
    >
      <div className="flex flex-wrap gap-2">
        <Button
          variant="success"
          disabled={busy || !ready || exhausted || route.state === 'running'}
          onClick={() => void run(route.state === 'paused' ? 'resume' : 'activate')}
        >
          {exhausted
            ? 'Límite del piloto alcanzado'
            : route.state === 'paused'
              ? 'Continuar'
              : pilot
                ? `Activar piloto de ${route.pilot_call_limit}`
                : 'Activar'}
        </Button>
        <Button
          variant="secondary"
          disabled={busy || route.state !== 'running'}
          onClick={() => void run('pause')}
        >
          Congelar / Pausar
        </Button>
        <Button
          variant="danger"
          disabled={busy || route.state === 'stopped'}
          onClick={() => void run('stop')}
        >
          Detener
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void run('sync')}>
          Actualizar conversaciones
        </Button>
      </div>
      {pilot && (
        <p className="rounded-lg bg-blue-50 p-3 text-sm text-plw-navy">
          Piloto de hasta {route.pilot_call_limit} intentos, dos simultáneos. Se pausa
          automáticamente al alcanzar el límite.{' '}
          {route.transfer_verified_at
            ? 'Transferencia confirmada por el agente.'
            : 'Transferencia todavía no comprobada; Alejandro debe confirmar las llamadas que realmente reciba.'}
        </p>
      )}
      <p className="text-sm text-neutral-600">
        Pausar o detener evita nuevos intentos. Las llamadas que ya comenzaron pueden finalizar.
        Continuar conserva el avance y no vuelve a marcar contactos ya intentados.
      </p>
      {!ready && (
        <div className="grid gap-3 rounded-lg bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Antes de activar este agente</p>
          <ol className="list-inside list-decimal space-y-1">
            <li>Configurar la voz Ana y su destino de transferencia.</li>
            {pilot ? (
              <>
                <li>Alejandro inicia sesión, selecciona Activo y confirma Línea registrada.</li>
                <li>
                  Esperar la señal del servidor y activar el piloto. Las transferencias se confirman
                  al recibirlas.
                </li>
              </>
            ) : (
              <>
                <li>Hacer una prueba al teléfono del administrador.</li>
                <li>El agente responde y pulsa “Recibí esta transferencia” en su historial.</li>
              </>
            )}
          </ol>
          <Button
            variant="secondary"
            disabled={busy || route.state === 'running'}
            onClick={() => void run('configure')}
          >
            {route.config_verified_at ? 'Verificar configuración' : 'Configurar Ana'}
          </Button>
          <label className="grid gap-1">
            {pilot ? 'Su número para una prueba opcional' : 'Su número para la prueba'}
            <input
              value={phone}
              inputMode="tel"
              maxLength={20}
              onChange={(e) => {
                setPhone(e.target.value);
                setRequestId(crypto.randomUUID());
              }}
              placeholder="Número en Costa Rica"
              className="h-11 rounded-lg border bg-white px-3"
              disabled={busy}
            />
          </label>
          <Button
            disabled={busy || !route.config_verified_at || !phone}
            onClick={() => void run('test')}
          >
            Probar llamada y transferencia
          </Button>
          <p>
            El agente debe iniciar sesión, activar su disponibilidad y conectar su teléfono. Una
            transferencia solicitada aún no confirma que llegó al agente.
          </p>
          {!runtime?.scheduler_ready && (
            <p>Servidor automático pendiente de instalación o configuración.</p>
          )}
        </div>
      )}
      {route.last_error && (
        <p role="alert" className="text-sm text-danger-700">
          {route.last_error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-plw-navy">
          {message}
        </p>
      )}
    </section>
  );
}
