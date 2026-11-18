import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  controlDialer,
  dentalServerAction,
  fetchDemoSample,
  startNextBatch,
} from '../services/dentalDialer';
import { dialerReady, describeReadback, type DentalDialer, type DentalRuntime, type AnaReadback } from '../models/dentalDialer';
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
  const [diagnosis, setDiagnosis] = useState('');
  const [readback, setReadback] = useState<AnaReadback | null>(null);
  const [anaTest, setAnaTest] = useState({
    phone: '',
    businessName: '',
    businessType: 'Clínica dental',
    contactName: '',
    requestId: crypto.randomUUID(),
    message: '',
    ok: false,
    voiceModel: 'current',
    candidateVoiceId: '',
  });
  async function runAnaTest() {
    // One id per submission: a double click reuses it (reserved once, no second dispatch);
    // after a success a fresh id lets the owner dial another deliberate test — no persistent cap.
    setBusy(true);
    setAnaTest((s) => ({ ...s, message: '', ok: false }));
    try {
      await dentalServerAction({
        action: 'ana_test',
        staffId: route.staff_id,
        requestId: anaTest.requestId,
        phone: anaTest.phone,
        businessName: anaTest.businessName,
        businessType: anaTest.businessType,
        contactName: anaTest.contactName,
        voiceModel: anaTest.voiceModel,
        candidateVoiceId:
          anaTest.voiceModel === 'current' ? '' : anaTest.candidateVoiceId.trim(),
      });
      setAnaTest((s) => ({
        ...s,
        ok: true,
        requestId: crypto.randomUUID(),
        message: 'Prueba registrada. La grabación y la transcripción aparecerán en el historial.',
      }));
      reload();
    } catch (e) {
      setAnaTest((s) => ({
        ...s,
        ok: false,
        message: e instanceof Error ? e.message : 'No se pudo completar.',
      }));
    } finally {
      setBusy(false);
    }
  }
  async function run(action: string) {
    setBusy(true);
    setMessage('');
    try {
      if (['configure', 'test', 'sync'].includes(action))
        await dentalServerAction({ action, staffId: route.staff_id }).then(
          (result) => {
            if (result && typeof result === 'object' && 'readback' in result)
              setReadback((result as { readback: AnaReadback }).readback);
          }
        );
      else if (action === 'next_batch') await startNextBatch(route.staff_id);
      else await controlDialer(route.staff_id, action);
      setMessage(
        action === 'test'
          ? 'Prueba de transferencia registrada. Compruebe el resultado en el historial.'
          : action === 'configure'
            ? 'Configuración aplicada y verificada en el proveedor. La lectura del agente aparece abajo.'
            : action === 'next_batch'
              ? `Nueva tanda de ${route.pilot_call_limit} iniciada.`
              : 'Acción guardada.'
      );
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudo completar.');
    } finally {
      setBusy(false);
    }
  }
  async function downloadSample() {
    setBusy(true);
    setMessage('');
    try {
      const { blob, voices } = await fetchDemoSample();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'demostracion-simulada-dos-voces.mp3';
      link.click();
      URL.revokeObjectURL(url);
      const names = voices.map((voice) => voice.name).join(' y ');
      setMessage(names ? `Muestra descargada con las voces ${names}.` : 'Muestra descargada.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudo generar la muestra.');
    } finally {
      setBusy(false);
    }
  }
  async function diagnose() {
    setBusy(true);
    setMessage('');
    try {
      const result = await dentalServerAction({ action: 'diagnose', staffId: route.staff_id });
      setDiagnosis(JSON.stringify(result, null, 2));
      if (result && typeof result === 'object' && 'readback' in result)
        setReadback((result as { readback: AnaReadback }).readback);
    } catch (e) {
      setDiagnosis('');
      setMessage(e instanceof Error ? e.message : 'No se pudo diagnosticar Ana.');
    } finally {
      setBusy(false);
    }
  }
  const ready = dialerReady(route, runtime);
  const pilot = Boolean(
    route.pilot_call_limit && route.pilot_call_limit >= 1 && route.pilot_call_limit <= 500
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
          disabled={busy || !ready || route.state === 'running'}
          onClick={() =>
            void run(exhausted ? 'next_batch' : route.state === 'paused' ? 'resume' : 'activate')
          }
        >
          {exhausted
            ? `Iniciar siguiente tanda de ${route.pilot_call_limit}`
            : route.state === 'paused'
              ? 'Continuar'
              : pilot
                ? `Activar tanda de ${route.pilot_call_limit}`
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
        {route.provider_agent_id && (
          <Button variant="secondary" disabled={busy} onClick={() => void diagnose()}>
            Diagnosticar Ana
          </Button>
        )}
      </div>
      {/* Right under the buttons: an activation refusal at the bottom of the panel went unseen. */}
      {message && (
        <p role="status" className="text-sm font-semibold text-plw-gold-soft">
          {message}
        </p>
      )}
      {route.last_error && (
        <p role="alert" className="text-sm text-danger-700">
          {route.last_error}
        </p>
      )}
      {pilot && (
        <p className="rounded-lg border border-plw-gold/30 bg-plw-gold/15 p-3 text-sm text-plw-gold-soft">
          Tandas de {route.pilot_call_limit} intentos. Al terminar una tanda el marcador se pausa;
          revise los resultados y pulse “Iniciar siguiente tanda” para seguir.{' '}
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
        <div className="grid gap-3 rounded-lg border border-warning-100 bg-warning-50 p-4 text-sm text-warning-700">
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
          {!runtime?.scheduler_ready && (
            <p>Servidor automático pendiente de instalación o configuración.</p>
          )}
        </div>
      )}
      {/* Configuring and test calls stay available whenever the dialer is not running,
          including after it is ready, so a new script can be pushed and heard first. */}
      {route.state !== 'running' && (
        <div className="grid gap-3 rounded-lg border p-4 text-sm">
          <Button variant="secondary" disabled={busy} onClick={() => void run('configure')}>
            Aplicar la última configuración de Ana
          </Button>
          {readback && (
            <p role="status" className="rounded-lg border bg-neutral-50 p-3">
              <span className="font-semibold">Lectura del agente en el proveedor:</span>{' '}
              {describeReadback(readback)}
              {readback.script_current
                ? ' — el guion vigente está aplicado.'
                : ' — todavía corre un guion anterior; pulse el botón de arriba.'}
            </p>
          )}
        </div>
      )}
      {route.provider_agent_id && route.state !== 'running' && (
        <div className="grid gap-3 rounded-lg border p-4 text-sm" aria-label="Prueba de Ana">
          <p className="font-semibold">Prueba de Ana — llamada real con el guion vigente</p>
          <p className="text-neutral-600">
            Ana llama desde su línea de campaigns con el mismo tono, voz y demostración de las
            llamadas reales. No transfiere, no crea clientes ni gasta la tanda. La grabación y
            transcripción aparecen en el historial como prueba.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1">
              Número de Costa Rica
              <input
                value={anaTest.phone}
                inputMode="tel"
                maxLength={13}
                onChange={(e) => setAnaTest({ ...anaTest, phone: e.target.value })}
                placeholder="2222 3333 o +506…"
                className="h-11 rounded-lg border bg-white px-3"
                disabled={busy}
              />
            </label>
            <label className="grid gap-1">
              Nombre del negocio
              <input
                value={anaTest.businessName}
                maxLength={120}
                onChange={(e) => setAnaTest({ ...anaTest, businessName: e.target.value })}
                placeholder="Clínica Dental Ejemplo"
                className="h-11 rounded-lg border bg-white px-3"
                disabled={busy}
              />
            </label>
            <label className="grid gap-1">
              Tipo de negocio
              <input
                value={anaTest.businessType}
                maxLength={120}
                onChange={(e) => setAnaTest({ ...anaTest, businessType: e.target.value })}
                placeholder="Clínica dental"
                className="h-11 rounded-lg border bg-white px-3"
                disabled={busy}
              />
            </label>
            <label className="grid gap-1">
              Persona a contactar (opcional)
              <input
                value={anaTest.contactName}
                maxLength={120}
                onChange={(e) => setAnaTest({ ...anaTest, contactName: e.target.value })}
                placeholder="Dra. Solís — vacío: la persona encargada"
                className="h-11 rounded-lg border bg-white px-3"
                disabled={busy}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              Voz de la prueba (solo esta llamada)
              <select
                value={anaTest.voiceModel}
                onChange={(e) => setAnaTest({ ...anaTest, voiceModel: e.target.value })}
                className="h-11 rounded-lg border bg-white px-3"
                disabled={busy}
              >
                <option value="current">Voz actual de Ana (producción)</option>
                <option value="v4_turbo">Comparar: Eleven v4 Turbo</option>
              </select>
            </label>
            {anaTest.voiceModel !== 'current' && (
              <label className="grid gap-1">
                Voz candidata (opcional)
                <input
                  value={anaTest.candidateVoiceId}
                  maxLength={60}
                  onChange={(e) => setAnaTest({ ...anaTest, candidateVoiceId: e.target.value })}
                  placeholder="Vacío: voz actual de Ana con el modelo nuevo"
                  className="h-11 rounded-lg border bg-white px-3"
                  disabled={busy}
                />
              </label>
            )}
          </div>
          <div>
            <Button
              variant="success"
              disabled={busy || !route.config_verified_at}
              onClick={() => void runAnaTest()}
            >
              Llamar de prueba
            </Button>
          </div>
          {anaTest.message && (
            <p
              role={anaTest.ok ? 'status' : 'alert'}
              className={anaTest.ok ? 'text-sm font-semibold text-success-700' : 'text-sm text-danger-700'}
            >
              {anaTest.message}
            </p>
          )}
        </div>
      )}
      <div className="grid gap-2 rounded-lg border p-4 text-sm">
        <p className="font-semibold">Demostración simulada de dos voces — no es una llamada real</p>
        <p className="text-neutral-600">
          Escena breve en español e inglés: Ana y la voz de un paciente de habla inglesa. Sirve para
          escuchar
          cómo quedaría la atención antes de activar el marcador.
        </p>
        <div>
          <Button variant="secondary" disabled={busy} onClick={() => void downloadSample()}>
            Descargar demostración (MP3)
          </Button>
        </div>
      </div>
      {diagnosis && (
        <pre className="max-h-64 overflow-auto rounded-lg bg-neutral-50 p-3 text-xs text-neutral-800">
          {diagnosis}
        </pre>
      )}
    </section>
  );
}
