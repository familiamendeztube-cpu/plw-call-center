import { formatDateTime } from '@/app/dates';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { AVAILABILITY_LABELS } from '@/features/presence/models/availability';
import type { AgentWorkload } from '@/features/admin/models/overview';

interface AgentWorkloadCardProps {
  workload: AgentWorkload;
}

function WorkloadRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-sm text-neutral-600">{label}</dt>
      <dd className="text-sm font-semibold text-plw-ink">{value}</dd>
    </div>
  );
}

export function AgentWorkloadCard({ workload }: AgentWorkloadCardProps) {
  const { agent, availability } = workload;
  const available = availability === 'active';

  return (
    <Panel as="article" className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-plw-navy text-sm font-semibold text-white">
            {agent.displayName.charAt(agent.displayName.length - 1)}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-plw-ink">{agent.displayName}</h3>
            <p className="text-xs text-neutral-500">
              Última actividad:{' '}
              {workload.lastActivityAt ? formatDateTime(workload.lastActivityAt) : 'Sin registros'}
            </p>
          </div>
        </div>
        <Badge tone={available ? 'success' : 'warning'}>{AVAILABILITY_LABELS[availability]}</Badge>
      </div>
      <dl className="divide-y divide-neutral-200 border-y border-neutral-200">
        <WorkloadRow label="Conversaciones abiertas" value={workload.openConversations} />
        <WorkloadRow label="Prospectos activos" value={workload.activeProspects} />
        <WorkloadRow label="Seguimientos para hoy" value={workload.followupsToday} />
      </dl>
    </Panel>
  );
}
