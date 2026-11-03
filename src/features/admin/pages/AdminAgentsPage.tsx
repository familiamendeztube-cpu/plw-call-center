import { IS_DEMO_MODE } from '@/app/appConfig';
import { PageHeader } from '@/components/ui/PageHeader';
import { DemoDataNote } from '@/components/ui/DemoDataNote';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { AdminSnapshotBoundary } from '@/features/admin/components/AdminSnapshotBoundary';
import { AgentManagementSection } from '@/features/admin/components/AgentManagementSection';
import { AgentWorkloadCard } from '@/features/admin/components/AgentWorkloadCard';
import { useAdminSnapshot } from '@/features/admin/hooks/useAdminSnapshot';
import { computeAgentWorkloads, type AdminSnapshot } from '@/features/admin/models/overview';

export function AdminAgentsPage() {
  const { state, reload } = useAdminSnapshot();

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Agentes"
        description="Carga de trabajo y cuentas de acceso."
        actions={<DemoDataNote />}
      />
      <AdminSnapshotBoundary state={state} reload={reload}>
        {(snapshot) => <AgentsContent snapshot={snapshot} />}
      </AdminSnapshotBoundary>
    </div>
  );
}

function AgentsContent({ snapshot }: { snapshot: AdminSnapshot }) {
  const workloads = computeAgentWorkloads(snapshot, new Date());

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        {workloads.map((workload) => (
          <AgentWorkloadCard key={workload.agent.id} workload={workload} />
        ))}
      </div>
      {IS_DEMO_MODE ? (
        <StatusMessage
          tone="info"
          title="La gestión de cuentas está disponible con la cuenta del administrador conectada."
        />
      ) : (
        <AgentManagementSection />
      )}
    </>
  );
}
