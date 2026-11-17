import { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { formatDateTime } from '@/app/dates';
import { PageHeader } from '@/components/ui/PageHeader';
import { DemoDataNote } from '@/components/ui/DemoDataNote';
import { Badge } from '@/components/ui/Badge';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Button } from '@/components/ui/Button';
import { ReassignDialog } from '@/features/assignment/components/ReassignDialog';
import { AdminCustomerDrawer } from '@/features/admin/components/AdminCustomerDrawer';
import { AdminSnapshotBoundary } from '@/features/admin/components/AdminSnapshotBoundary';
import { useAdminSnapshot } from '@/features/admin/hooks/useAdminSnapshot';
import type { AdminSnapshot } from '@/features/admin/models/overview';
import { buildAgentNameMap } from '@/features/admin/models/lookups';
import {
  isStale,
  lastContactByProspect,
  STALE_DAYS,
  toCsv,
} from '@/features/admin/models/prospectTable';
import { matchesCustomerQuery } from '@/features/customers/models/customerEntries';
import {
  PAYMENT_STATUS_LABELS,
  SALES_STAGE_LABELS,
  SALES_STAGES,
  type Prospect,
  type SalesStage,
} from '@/features/leads/models/prospect';

const ALL = 'all';
const UNASSIGNED_OWNER = 'unassigned';
const SOURCE_LABELS: Record<string, string> = {
  email: 'Correo',
  ai_call: 'Llamada IA',
  whatsapp: 'WhatsApp',
  manual: 'Manual',
};

const fieldClass = 'h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-plw-ink';

export function AdminProspectsPage() {
  const { state, reload, refresh } = useAdminSnapshot();

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Prospectos"
        description="Todos los prospectos del equipo. Abre uno para ver su conversación, notas, llamadas y pago."
        actions={<DemoDataNote />}
      />
      <AdminSnapshotBoundary state={state} reload={reload}>
        {(snapshot) => <ProspectsTable snapshot={snapshot} onChanged={refresh} />}
      </AdminSnapshotBoundary>
    </div>
  );
}

function ProspectsTable({
  snapshot,
  onChanged,
}: {
  snapshot: AdminSnapshot;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState(ALL);
  const [stage, setStage] = useState<SalesStage | typeof ALL>(ALL);
  const [source, setSource] = useState(ALL);
  const [staleOnly, setStaleOnly] = useState(false);
  const [assigning, setAssigning] = useState<Prospect | null>(null);
  const [opened, setOpened] = useState<Prospect | null>(null);
  const agentNames = buildAgentNameMap(snapshot.agents);
  const lastContact = useMemo(
    () => lastContactByProspect(snapshot.prospects, snapshot.conversations),
    [snapshot.prospects, snapshot.conversations]
  );
  const sources = [...new Set(snapshot.prospects.map((prospect) => prospect.source))].sort();
  const now = Date.now();

  const visible = snapshot.prospects.filter(
    (prospect) =>
      matchesCustomerQuery(prospect, query) &&
      (owner === ALL ||
        (owner === UNASSIGNED_OWNER
          ? prospect.assignedAgentId === null
          : prospect.assignedAgentId === owner)) &&
      (stage === ALL || prospect.stage === stage) &&
      (source === ALL || prospect.source === source) &&
      (!staleOnly || isStale(prospect, lastContact.get(prospect.id), now))
  );

  const exportCsv = () => {
    const rows = [
      [
        'Negocio',
        'Contacto',
        'Teléfono',
        'Correo',
        'Giro',
        'Responsable',
        'Etapa',
        'Pago',
        'Origen',
        'Último contacto',
        'Próximo seguimiento',
      ],
      ...visible.map((prospect) => [
        prospect.businessName,
        prospect.contactName,
        prospect.phone,
        prospect.email,
        prospect.businessCategory,
        prospect.assignedAgentId ? (agentNames[prospect.assignedAgentId] ?? '') : 'Sin asignar',
        SALES_STAGE_LABELS[prospect.stage],
        PAYMENT_STATUS_LABELS[prospect.paymentStatus],
        SOURCE_LABELS[prospect.source] ?? prospect.source,
        formatDateTime(lastContact.get(prospect.id) ?? prospect.createdAt),
        prospect.nextFollowUpAt ? formatDateTime(prospect.nextFollowUpAt) : '',
      ]),
    ];
    // The byte-order mark makes Excel read the accents as UTF-8.
    const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `prospectos-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="relative flex min-w-[14rem] flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Buscar</span>
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3.5 left-3 text-neutral-400"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Negocio, contacto o número"
            className={`${fieldClass} pl-9`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Responsable</span>
          <select
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            className={fieldClass}
          >
            <option value={ALL}>Todos los agentes</option>
            <option value={UNASSIGNED_OWNER}>Sin asignar</option>
            {snapshot.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Etapa</span>
          <select
            value={stage}
            onChange={(event) => setStage(event.target.value as SalesStage | typeof ALL)}
            className={fieldClass}
          >
            <option value={ALL}>Todas</option>
            {SALES_STAGES.map((item) => (
              <option key={item} value={item}>
                {SALES_STAGE_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Origen</span>
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className={fieldClass}
          >
            <option value={ALL}>Todos</option>
            {sources.map((item) => (
              <option key={item} value={item}>
                {SOURCE_LABELS[item] ?? item}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-11 items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={staleOnly}
            onChange={(event) => setStaleOnly(event.target.checked)}
            className="h-4 w-4"
          />
          Sin contacto en {STALE_DAYS}+ días
        </label>
        <Button variant="secondary" onClick={exportCsv} disabled={visible.length === 0}>
          <Download size={16} aria-hidden="true" />
          Exportar CSV
        </Button>
      </div>
      <p className="text-sm text-neutral-600">{visible.length} prospectos</p>
      {visible.length === 0 ? (
        <StatusMessage tone="empty" title="No hay prospectos con estos filtros." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-white shadow-panel">
          <table className="w-full min-w-[900px] text-left text-sm">
            <caption className="sr-only">Prospectos del equipo</caption>
            <thead className="bg-plw-ivory text-xs uppercase tracking-wide text-neutral-600">
              <tr>
                {[
                  'Negocio',
                  'Responsable',
                  'Etapa',
                  'Pago',
                  'Último contacto',
                  'Próximo seguimiento',
                ].map((heading) => (
                  <th key={heading} scope="col" className="px-4 py-3 font-semibold">
                    {heading}
                  </th>
                ))}
                <th scope="col" className="px-4 py-3 font-semibold">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {visible.map((prospect) => {
                const contact = lastContact.get(prospect.id);
                return (
                  <tr key={prospect.id} className="align-top">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setOpened(prospect)}
                        className="text-left font-semibold text-plw-navy underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/60"
                      >
                        {prospect.businessName}
                      </button>
                      <p className="text-xs text-neutral-500">
                        {[
                          prospect.businessCategory,
                          SOURCE_LABELS[prospect.source] ?? prospect.source,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {prospect.assignedAgentId ? (
                        agentNames[prospect.assignedAgentId]
                      ) : (
                        <Badge tone="warning">Sin asignar</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="navy">{SALES_STAGE_LABELS[prospect.stage]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {PAYMENT_STATUS_LABELS[prospect.paymentStatus]}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {contact ? formatDateTime(contact) : '—'}
                      {isStale(prospect, contact, now) ? (
                        <Badge tone="danger" className="ml-2">
                          Sin contacto
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {prospect.nextFollowUpAt
                        ? formatDateTime(prospect.nextFollowUpAt)
                        : 'Sin fecha programada'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="secondary" size="sm" onClick={() => setAssigning(prospect)}>
                        {prospect.assignedAgentId ? 'Reasignar' : 'Asignar'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {assigning ? (
        <ReassignDialog
          prospect={assigning}
          agents={snapshot.agents}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            onChanged();
          }}
        />
      ) : null}
      {opened ? (
        <AdminCustomerDrawer
          prospect={opened}
          snapshot={snapshot}
          agentNames={agentNames}
          onClose={() => setOpened(null)}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}
