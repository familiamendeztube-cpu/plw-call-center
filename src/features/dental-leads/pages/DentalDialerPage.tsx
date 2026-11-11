import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/context/useAuth';
import { useDentalDialer } from '../hooks/useDentalDialer';
import { useDentalLeads } from '../hooks/useDentalLeads';
import { DentalDialerControls } from '../components/DentalDialerControls';
import { DentalCallHistory } from '../components/DentalCallHistory';
import { DentalFollowUps } from '../components/DentalFollowUps';
export function DentalDialerPage() {
  const { session } = useAuth();
  const admin = session?.role === 'admin';
  const state = useDentalDialer(session?.source === 'production');
  const leads = useDentalLeads(session?.source === 'production', admin);
  const [selected, setSelected] = useState('agent-2');
  const staffId = session?.role === 'agent' ? session.agentId : selected;
  const route = state.routes.find((r) => r.staff_id === staffId);
  const agentLabel = staffId === 'agent-3' ? 'Valeska' : 'Alejandro';
  const calls = state.calls.filter((c) => c.staff_id === staffId);
  const live = calls.filter((c) => !c.is_test);
  const pilotAttempts = Math.max(0, live.length - (route?.pilot_baseline_count ?? 0));
  const own = leads.leads.filter((l) => l.owner_staff_id === staffId);
  const totals = [
    ['Dentistas asignados', own.length],
    ['Intentos', live.length],
    ['Llamadas activas', live.filter((c) => ['reserved', 'started'].includes(c.state)).length],
    ['Interesados', own.filter((l) => l.status === 'interested').length],
    ['Transferencias solicitadas', live.filter((c) => c.transfer_status === 'requested').length],
    [
      'Transferencias recibidas',
      live.filter((c) => c.transfer_status === 'agent_confirmed').length,
    ],
    ['Sin confirmar', live.filter((c) => c.state === 'uncertain').length],
  ];
  if (route?.pilot_call_limit)
    totals.push(['Intentos del piloto', `${pilotAttempts} / ${route.pilot_call_limit}`]);
  // Agents see only their to-do list and their calls; the dialer's controls and counters are
  // for administrators.
  const agentNames = session?.role === 'agent' ? { [session.agentId]: session.displayName } : {};
  return (
    <div className="grid gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={admin ? 'Marcador dental · Ana' : 'Llamadas de Anna'}
        description={
          admin
            ? 'Los agentes activos se turnan las llamadas en la línea 4010 6198. De lunes a viernes, de 9:00 a 17:00, hora de Costa Rica.'
            : 'Los dentistas que Anna dejó para usted y el historial de sus llamadas, con transcripción y grabación.'
        }
        actions={
          <Link
            to={admin ? '/admin/dentistas' : '/dentistas'}
            className="rounded-lg border bg-white px-4 py-2 text-sm"
          >
            Ver dentistas
          </Link>
        }
      />
      {admin && (
        <label className="grid max-w-sm gap-2 text-sm font-medium">
          Agente
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="h-12 rounded-lg border bg-white px-3"
          >
            <option value="agent-2">Alejandro</option>
            <option value="agent-3">Valeska</option>
          </select>
        </label>
      )}
      {state.loading ? (
        <StatusMessage tone="loading" title="Cargando marcador…" />
      ) : state.error ? (
        <StatusMessage
          tone="error"
          title={state.error}
          action={<Button onClick={state.reload}>Reintentar</Button>}
        />
      ) : admin ? (
        <>
          <div className="rounded-xl bg-plw-navy p-5 text-white">
            <p className="text-lg font-semibold">
              {route?.state === 'running'
                ? 'Activo'
                : route?.state === 'paused'
                  ? 'En pausa'
                  : 'Detenido'}
            </p>
            <p className="mt-1 text-sm text-white">
              Se marca únicamente cuando el agente está activo y disponible. El avance queda
              guardado al cerrar esta página.
            </p>
            <p className="mt-2 text-xs text-white">
              Última señal del servidor:{' '}
              {state.runtime?.last_tick_at
                ? new Date(state.runtime.last_tick_at).toLocaleString('es-CR', {
                    timeZone: 'America/Costa_Rica',
                  })
                : 'Sin señal todavía'}
            </p>
          </div>
          {leads.loading ? (
            <StatusMessage tone="loading" title="Cargando estadísticas…" />
          ) : leads.error ? (
            <StatusMessage tone="error" title={leads.error} />
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {totals.map(([label, value]) => (
                <div key={label} className="rounded-xl border bg-white p-4">
                  <p className="text-xs text-neutral-500">{label}</p>
                  <p className="mt-1 text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-neutral-500">
            Los contadores excluyen las pruebas. El historial y las transcripciones se actualizan
            cada 15 segundos cuando el proveedor entrega los datos.
          </p>
          <p className="text-sm font-medium text-neutral-700">{`Agente seleccionado: ${agentLabel}`}</p>
          {route ? (
            <DentalDialerControls
              key={`controls-${staffId}`}
              route={route}
              runtime={state.runtime}
              reload={state.reload}
              pilotAttempts={pilotAttempts}
            />
          ) : (
            <StatusMessage
              tone="info"
              title="Falta configurar la ruta telefónica de este agente."
            />
          )}
          <DentalCallHistory key={`history-${staffId}`} calls={calls} reload={state.reload} />
        </>
      ) : (
        <>
          {leads.loading ? (
            <StatusMessage tone="loading" title="Cargando sus dentistas…" />
          ) : leads.error ? (
            <StatusMessage
              tone="error"
              title={leads.error}
              action={<Button onClick={leads.reload}>Reintentar</Button>}
            />
          ) : (
            <DentalFollowUps
              leads={own}
              calls={calls}
              agentNames={agentNames}
              reload={leads.reload}
            />
          )}
          <DentalCallHistory calls={calls} reload={state.reload} />
        </>
      )}
    </div>
  );
}
