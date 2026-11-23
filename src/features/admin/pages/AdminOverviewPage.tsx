import { useState } from 'react';
import { PhoneCallReport } from '@/features/admin/components/PhoneCallReport';
import { MissedCallsCard } from '@/features/admin/components/MissedCallsCard';
import { CreateInquiryDialog } from '@/features/assignment/components/CreateInquiryDialog';
import {
  Activity,
  CalendarClock,
  FileText,
  Inbox,
  MessageCircle,
  Presentation,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DemoDataNote } from '@/components/ui/DemoDataNote';
import { ActivityList } from '@/features/presence/components/ActivityList';
import { AdminSnapshotBoundary } from '@/features/admin/components/AdminSnapshotBoundary';
import { AgentWorkloadCard } from '@/features/admin/components/AgentWorkloadCard';
import { TourismMilestoneSummary } from '@/features/admin/components/TourismMilestoneSummary';
import { TourismWeeklyFunnel } from '@/features/admin/components/TourismWeeklyFunnel';
import { MetricCard } from '@/features/admin/components/MetricCard';
import { useAdminSnapshot } from '@/features/admin/hooks/useAdminSnapshot';
import {
  computeAgentWorkloads,
  computeOverviewMetrics,
  type AdminSnapshot,
} from '@/features/admin/models/overview';
import { buildAgentNameMap } from '@/features/admin/models/lookups';

export function AdminOverviewPage() {
  const { state, reload, refresh } = useAdminSnapshot();

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Resumen"
        description="Disponibilidad del equipo y actividad comercial del día."
        actions={<DemoDataNote />}
      />
      <AdminSnapshotBoundary state={state} reload={reload}>
        {(snapshot) => <OverviewContent snapshot={snapshot} onChanged={refresh} />}
      </AdminSnapshotBoundary>
    </div>
  );
}

function OverviewContent({
  snapshot,
  onChanged,
}: {
  snapshot: AdminSnapshot;
  onChanged: () => void;
}) {
  const now = new Date();
  const metrics = computeOverviewMetrics(snapshot, now);
  const workloads = computeAgentWorkloads(snapshot, now);
  const agentNames = buildAgentNameMap(snapshot.agents);
  const [inquiryPhone, setInquiryPhone] = useState<string | null>(null);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Agentes disponibles"
          value={`${metrics.availableAgents} de ${metrics.totalAgents}`}
          hint={
            metrics.agentsInCall > 0
              ? `En Activo con la aplicación abierta · ${metrics.agentsInCall} en llamada`
              : 'En Activo con la aplicación abierta'
          }
          icon={<Users size={18} aria-hidden="true" />}
        />
        <MetricCard
          label="Consultas en espera"
          value={metrics.waitingInquiries}
          hint="Conversaciones esperando respuesta"
          icon={<Inbox size={18} aria-hidden="true" />}
        />
        <MetricCard
          label="Conversaciones sin respuesta"
          value={metrics.unansweredConversations}
          hint="Mensajes de clientes sin leer"
          icon={<MessageCircle size={18} aria-hidden="true" />}
        />
        <MetricCard
          label="Seguimientos para hoy"
          value={metrics.followupsDueToday}
          hint="Pendientes con vencimiento hoy"
          icon={<CalendarClock size={18} aria-hidden="true" />}
        />
        <MetricCard
          label="Demostraciones agendadas"
          value={metrics.demosScheduled}
          hint="Prospectos en etapa Demo agendada"
          icon={<Presentation size={18} aria-hidden="true" />}
        />
        <MetricCard
          label="Propuestas enviadas"
          value={metrics.proposalsSent}
          hint="Prospectos en etapa Propuesta enviada"
          icon={<FileText size={18} aria-hidden="true" />}
        />
      </div>
      <MissedCallsCard
        prospects={snapshot.prospects}
        agentNames={agentNames}
        onCreateInquiry={setInquiryPhone}
      />
      {inquiryPhone !== null ? (
        <CreateInquiryDialog
          initialPhone={inquiryPhone}
          onClose={() => setInquiryPhone(null)}
          onDone={() => {
            setInquiryPhone(null);
            onChanged();
          }}
        />
      ) : null}
      <PhoneCallReport agentNames={agentNames} />
      <TourismMilestoneSummary />
      <TourismWeeklyFunnel />
      <section aria-labelledby="workload-heading" className="flex flex-col gap-4">
        <h2 id="workload-heading" className="text-lg font-semibold text-plw-ink">
          Carga de trabajo por agente
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {workloads.map((workload) => (
            <AgentWorkloadCard key={workload.agent.id} workload={workload} />
          ))}
        </div>
      </section>
      <section aria-labelledby="activity-heading" className="flex flex-col gap-4">
        <h2
          id="activity-heading"
          className="flex items-center gap-2 text-lg font-semibold text-plw-ink"
        >
          <Activity size={18} className="text-plw-gold" aria-hidden="true" />
          Actividad comercial reciente
        </h2>
        <ActivityList
          events={metrics.recentActivity}
          agentNames={agentNames}
          emptyTitle="Aún no hay actividad registrada."
        />
      </section>
    </>
  );
}
