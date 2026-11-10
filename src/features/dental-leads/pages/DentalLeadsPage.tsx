import { useMemo, useState } from 'react';
import { useAuth } from '@/features/auth/context/useAuth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useDentalLeads } from '../hooks/useDentalLeads';
import { DentalLeadList } from '../components/DentalLeadList';
import { DentalCampaignPanel } from '../components/DentalCampaignPanel';
import {
  DENTAL_STATUS,
  dentalCounts,
  filterDentalLeads,
  type DentalFilter,
} from '../models/dentalLead';
const PAGE_SIZE = 25;
export function DentalLeadsPage() {
  const { session } = useAuth();
  const admin = session?.role === 'admin';
  const state = useDentalLeads(session?.source === 'production', admin);
  const [filter, setFilter] = useState<DentalFilter>({
    query: '',
    province: '',
    owner: '',
    status: '',
  });
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => filterDentalLeads(state.leads, filter), [state.leads, filter]);
  const counts = dentalCounts(state.leads);
  const provinces = [...new Set(state.leads.map((l) => l.province).filter(Boolean))].sort();
  const names = Object.fromEntries(state.agents.map((a) => [a.id, a.display_name]));
  if (session?.role === 'agent') names[session.agentId] = session.displayName;
  const activePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  function change(key: keyof DentalFilter, value: string) {
    setFilter((f) => ({ ...f, [key]: value }));
    setPage(0);
  }
  const fieldClass = 'h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm';
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Dentistas de Costa Rica"
        description={
          admin
            ? 'Búsqueda local, contactos públicos y asignación por agente.'
            : 'Sus clínicas asignadas y el resultado de cada conversación.'
        }
        actions={
          <Button variant="secondary" onClick={state.reload} disabled={state.loading}>
            Actualizar
          </Button>
        }
      />
      {state.loading ? (
        <StatusMessage tone="loading" title="Actualizando dentistas…" />
      ) : state.error ? (
        <StatusMessage
          tone="error"
          title={state.error}
          action={<Button onClick={state.reload}>Reintentar</Button>}
        />
      ) : (
        <>
          {state.campaigns.map((campaign) => (
            <DentalCampaignPanel
              key={campaign.id}
              campaign={campaign}
              leads={state.leads.filter((l) => l.campaign_id === campaign.id)}
              agents={state.agents}
              admin={admin}
              reload={state.reload}
            />
          ))}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Contactos', counts.total],
              ['Pendientes', counts.pending],
              ['Interesados', counts.interested],
              ['Volver a llamar', counts.callback],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-white p-4">
                <p className="text-sm text-neutral-500">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-plw-navy">{value}</p>
              </div>
            ))}
          </div>
          <section
            className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
            aria-label="Buscar dentistas"
          >
            <label className="grid gap-1 text-sm">
              Clínica, cantón o teléfono
              <input
                value={filter.query}
                onChange={(e) => change('query', e.target.value)}
                type="search"
                className={fieldClass}
                placeholder="Buscar en la lista"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Provincia
              <select
                className={fieldClass}
                value={filter.province}
                onChange={(e) => change('province', e.target.value)}
              >
                <option value="">Todas las provincias</option>
                {provinces.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            {admin && (
              <label className="grid gap-1 text-sm">
                Agente
                <select
                  className={fieldClass}
                  value={filter.owner}
                  onChange={(e) => change('owner', e.target.value)}
                >
                  <option value="">Todos</option>
                  <option value="unassigned">Sin asignar</option>
                  {state.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.display_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="grid gap-1 text-sm">
              Resultado
              <select
                className={fieldClass}
                value={filter.status}
                onChange={(e) => change('status', e.target.value)}
              >
                <option value="">Todos</option>
                {Object.entries(DENTAL_STATUS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <p className="text-sm text-neutral-600">
            {filtered.length} contactos encontrados. Los teléfonos provienen de fuentes públicas; su
            vigencia se confirma al contactar. Esta lista no representa a todos los dentistas del
            país.
          </p>
          {filtered.length ? (
            <DentalLeadList
              leads={filtered.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE)}
              agentNames={names}
              reload={state.reload}
            />
          ) : (
            <StatusMessage tone="empty" title="No hay dentistas para estos filtros." />
          )}
          {filtered.length > PAGE_SIZE && (
            <nav
              aria-label="Páginas de dentistas"
              className="flex items-center justify-center gap-4"
            >
              <Button
                variant="secondary"
                disabled={activePage === 0}
                onClick={() => setPage(activePage - 1)}
              >
                Anterior
              </Button>
              <span className="text-sm">
                {activePage + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}
              </span>
              <Button
                variant="secondary"
                disabled={(activePage + 1) * PAGE_SIZE >= filtered.length}
                onClick={() => setPage(activePage + 1)}
              >
                Siguiente
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
