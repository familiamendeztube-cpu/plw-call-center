import { PageHeader } from '@/components/ui/PageHeader';
import { DemoDataNote } from '@/components/ui/DemoDataNote';
import { FollowupBoard } from '@/features/followups/components/FollowupBoard';
import { AdminSnapshotBoundary } from '@/features/admin/components/AdminSnapshotBoundary';
import { useAdminSnapshot } from '@/features/admin/hooks/useAdminSnapshot';
import type { AdminSnapshot } from '@/features/admin/models/overview';
import { buildAgentNameMap, buildProspectNameMap } from '@/features/admin/models/lookups';

export function AdminFollowupsPage() {
  const { state, reload } = useAdminSnapshot();

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Seguimientos"
        description="Seguimientos programados de todo el equipo, agrupados por fecha."
        actions={<DemoDataNote />}
      />
      <AdminSnapshotBoundary state={state} reload={reload}>
        {(snapshot) => <FollowupsContent snapshot={snapshot} />}
      </AdminSnapshotBoundary>
    </div>
  );
}

function FollowupsContent({ snapshot }: { snapshot: AdminSnapshot }) {
  return (
    <FollowupBoard
      followups={snapshot.followups}
      prospectNames={buildProspectNameMap(snapshot.prospects)}
      ownerNames={buildAgentNameMap(snapshot.agents)}
      now={new Date()}
    />
  );
}
