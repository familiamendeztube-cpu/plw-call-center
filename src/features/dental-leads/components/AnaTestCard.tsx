import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { dentalServerAction } from '../services/dentalDialer';
import { describeReadback, type DentalDialer, type AnaReadback } from '../models/dentalDialer';

export function AnaTestCard({ route, reload }: { route: DentalDialer; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [readback, setReadback] = useState<AnaReadback | null>(null);
  const [anaTest, setAnaTest] = useState({
    phone: '',
    businessName: '',
    businessType: 'Clínica dental',
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
      if (action === 'configure')
        await dentalServerAction({ action, staffId: route.staff_id }).then((result) => {
          if (result && typeof result === 'object' && 'readback' in result)
            setReadback((result as { readback: AnaReadback }).readback);
        });
      else if (action === 'diagnose') {
        const result = await dentalServerAction({ action, staffId: route.staff_id });
        setDiagnosis(JSON.stringify(result, null, 2));
        if (result && typeof result === 'object' && 'readback' in result)
          setReadback((result as { readback: AnaReadback }).readback);
      }
      setMessage(
        action === 'configure'
          ? 'Configuración aplicada y verificada en el proveedor. La lectura del agente aparece abajo.'
          : 'Diagnóstico listo.'
      );
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudo completar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
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
      {route.provider_agent_id ? (
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
      ) : (
        <p className="text-sm text-neutral-600">
          Falta configurar la ruta telefónica de este agente.
        </p>
      )}
      {route.provider_agent_id && (
        <div className="grid gap-2 rounded-lg border p-4 text-sm">
          <Button variant="secondary" disabled={busy} onClick={() => void run('diagnose')}>
            Diagnosticar Ana
          </Button>
          {diagnosis && (
            <pre className="max-h-64 overflow-auto rounded-lg bg-neutral-50 p-3 text-xs text-neutral-800">
              {diagnosis}
            </pre>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="text-sm font-semibold text-plw-gold-soft">
          {message}
        </p>
      )}
    </>
  );
}
