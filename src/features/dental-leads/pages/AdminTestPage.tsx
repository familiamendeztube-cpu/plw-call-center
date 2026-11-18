import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/context/useAuth';
import { useDentalDialer } from '../hooks/useDentalDialer';
import { useDentalLeads } from '../hooks/useDentalLeads';
import { AnaTestCard } from '../components/AnaTestCard';
import { DentalCallHistory } from '../components/DentalCallHistory';

// Standalone "Test" page: only Prueba de Ana and its history, no campaign controls or counters.
export function AdminTestPage() {
  const { session } = useAuth();
  const admin = session?.role === 'admin';
  const state = useDentalDialer(session?.source === 'production');
  const leads = useDentalLeads(session?.source === 'production', admin);
  const [selected, setSelected] = useState<string | null>(null);
  // The selector is controlled: reloads and refetches keep the administrator's choice.
  const [lastAgent, setLastAgent] = useState<string | null>(null);
  const staffId =
    selected ??
    (lastAgent && state.routes.some((r) => r.staff_id === lastAgent) ? lastAgent : null) ??
    state.routes[0]?.staff_id ??
    '';
  const pick = (value: string) => {
    setSelected(value);
    setLastAgent(value);
  };
  const route = state.routes.find((r) => r.staff_id === staffId);
  const staffNames = Object.fromEntries(leads.agents.map((a) => [a.id, a.display_name]));
  const agentLabel = staffNames[staffId] ?? staffId;
  const calls = state.calls.filter((c) => c.staff_id === staffId && c.is_test);
  return (
    <div className="grid gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Test"
        description="Prueba de Ana: llamada real con el guion vigente. Aislada de la campaña: no transfiere, no crea clientes y no gasta la tanda."
      />
      {state.loading ? (
        <StatusMessage tone="loading" title="Cargando prueba…" />
      ) : state.error ? (
        <StatusMessage
          tone="error"
          title={state.error}
          action={<Button onClick={state.reload}>Reintentar</Button>}
        />
      ) : (
        <>
          <label className="grid max-w-sm gap-2 text-sm font-medium">
            Agente
            <select
              value={staffId}
              onChange={(e) => pick(e.target.value)}
              className="h-12 rounded-lg border bg-white px-3"
            >
              {state.routes.map((r) => (
                <option key={r.staff_id} value={r.staff_id}>
                  {staffNames[r.staff_id] ?? r.staff_id}
                </option>
              ))}
            </select>
          </label>
          {route ? (
            <>
              <div className="rounded-xl bg-plw-navy p-5 text-white">
                <p className="text-lg font-semibold">
                  {route.state === 'running'
                    ? 'Campaña activa — la prueba corre igual'
                    : route.state === 'paused'
                      ? 'Campaña en pausa'
                      : 'Campaña detenida'}
                </p>
                <p className="mt-1 text-sm text-white">
                  La prueba de Ana funciona con la campaña activa, en pausa o detenida. Solo prueba:
                  ningún cambio en la campaña desde esta página.
                </p>
              </div>
              {route.state === 'running' && (
                <p className="text-xs text-neutral-500">
                  Con la campaña activa, la llamada de prueba sigue funcionando; el servidor rechaza
                  cambios de configuración hasta que la campaña esté detenida o en pausa.
                </p>
              )}
              <AnaTestCard key={`test-${staffId}`} route={route} reload={state.reload} />
              <DentalCallHistory key={`history-${staffId}`} calls={calls} reload={state.reload} />
            </>
          ) : (
            <StatusMessage tone="info" title="Falta configurar la ruta telefónica de este agente." />
          )}
        </>
      )}
      <p className="text-xs text-neutral-500">{`Agente seleccionado: ${agentLabel}`}</p>
    </div>
  );
}
