import { useMemo, useState } from 'react';
import { formatDateTime } from '@/app/dates';
import { PageHeader } from '@/components/ui/PageHeader';
import { DemoDataNote } from '@/components/ui/DemoDataNote';
import { Badge } from '@/components/ui/Badge';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Button } from '@/components/ui/Button';
import { ReassignDialog } from '@/features/assignment/components/ReassignDialog';
import { AdminSnapshotBoundary } from '@/features/admin/components/AdminSnapshotBoundary';
import { useAdminSnapshot } from '@/features/admin/hooks/useAdminSnapshot';
import type { AdminSnapshot } from '@/features/admin/models/overview';
import { buildAgentNameMap } from '@/features/admin/models/lookups';
import {
  PAYMENT_STATUS_LABELS,
  SALES_STAGE_LABELS,
  type Prospect,
} from '@/features/leads/models/prospect';

const ALL_OWNERS = 'all';
const UNASSIGNED_OWNER = 'unassigned';

export function AdminProspectsPage() {
  const { state, reload } = useAdminSnapshot();

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Prospectos"
        description="Todos los prospectos del equipo, con responsable y próxima acción."
        actions={<DemoDataNote />}
      />
      <AdminSnapshotBoundary state={state} reload={reload}>
        {(snapshot) => <ProspectsTable snapshot={snapshot} onChanged={reload} />}
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
  const [owner, setOwner] = useState(ALL_OWNERS);
  const [assigning, setAssigning] = useState<Prospect | null>(null);
  const agentNames = buildAgentNameMap(snapshot.agents);
  const visible = useMemo(
    () => snapshot.prospects.filter((prospect) => matchesOwner(prospect, owner)),
    [snapshot.prospects, owner]
  );

  return (
    <div className="flex flex-col gap-4">
      <label className="flex max-w-xs flex-col gap-1.5">
        <span className="text-sm font-medium text-neutral-700">Responsable</span>
        <select
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
          className="h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-plw-ink"
        >
          <option value={ALL_OWNERS}>Todos los agentes</option>
          <option value={UNASSIGNED_OWNER}>Sin asignar</option>
          {snapshot.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.displayName}
            </option>
          ))}
        </select>
      </label>
      {visible.length === 0 ? (
        <StatusMessage tone="empty" title="No hay prospectos para este responsable." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-white shadow-panel">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">Prospectos del equipo</caption>
            <thead className="bg-plw-ivory text-xs uppercase tracking-wide text-neutral-600">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Negocio
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Responsable
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Etapa
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Pago
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Próximo seguimiento
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {visible.map((prospect) => (
                <tr key={prospect.id} className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-plw-ink">{prospect.businessName}</p>
                    <p className="text-xs text-neutral-500">{prospect.businessCategory}</p>
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
              ))}
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
    </div>
  );
}

function matchesOwner(prospect: Prospect, owner: string): boolean {
  if (owner === ALL_OWNERS) {
    return true;
  }
  if (owner === UNASSIGNED_OWNER) {
    return prospect.assignedAgentId === null;
  }
  return prospect.assignedAgentId === owner;
}
