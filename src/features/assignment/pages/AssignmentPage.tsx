import { useState } from 'react';
import { Plus, RotateCcw } from 'lucide-react';
import { useAppServices } from '@/app/ServicesContext';
import { useAsync } from '@/app/useAsync';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { cx } from '@/components/ui/cx';
import { AgentWorkloadCard } from '@/features/admin/components/AgentWorkloadCard';
import { AdminSnapshotBoundary } from '@/features/admin/components/AdminSnapshotBoundary';
import { useAdminSnapshot } from '@/features/admin/hooks/useAdminSnapshot';
import { computeAgentWorkloads, type AdminSnapshot } from '@/features/admin/models/overview';
import type { AssignmentBoard } from '@/features/assignment/models/assignment';
import {
  buildAssignmentViews,
  type AssignmentViews,
} from '@/features/assignment/models/assignmentRows';
import { AssignmentRows } from '@/features/assignment/components/AssignmentRows';
import { CreateInquiryDialog } from '@/features/assignment/components/CreateInquiryDialog';
import { ReassignDialog } from '@/features/assignment/components/ReassignDialog';

type AssignmentTab = 'waiting' | 'assigned' | 'overdue' | 'workload' | 'history';
type AssignmentDialog = { kind: 'create' } | { kind: 'reassign'; prospectId: string } | null;

const TAB_LABELS: Record<AssignmentTab, string> = {
  waiting: 'En espera',
  assigned: 'Asignados',
  overdue: 'Vencidos',
  workload: 'Carga',
  history: 'Historial',
};

const TABS: AssignmentTab[] = ['waiting', 'assigned', 'overdue', 'workload', 'history'];

export function AssignmentPage() {
  const services = useAppServices();
  const snapshot = useAdminSnapshot();
  const board = useAsync(() => services.assignments.loadBoard(), [services]);
  const [tab, setTab] = useState<AssignmentTab>('waiting');
  const [dialog, setDialog] = useState<AssignmentDialog>(null);

  function refreshAfterChange() {
    setDialog(null);
    snapshot.reload();
    board.reload();
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Asignaciones"
        description="Consultas en espera, prospectos asignados, casos vencidos y reasignaciones con motivo."
        actions={
          <Button onClick={() => setDialog({ kind: 'create' })}>
            <Plus size={16} aria-hidden="true" />
            Nueva consulta
          </Button>
        }
      />
      <AdminSnapshotBoundary state={snapshot.state} reload={snapshot.reload}>
        {(data) => (
          <>
            <BoardContent
              snapshot={data}
              board={board.state}
              tab={tab}
              onTabChange={setTab}
              onRetry={board.reload}
              onReassign={(prospectId) => setDialog({ kind: 'reassign', prospectId })}
            />
            {dialog?.kind === 'create' ? (
              <CreateInquiryDialog onClose={() => setDialog(null)} onDone={refreshAfterChange} />
            ) : null}
            {dialog?.kind === 'reassign'
              ? renderReassign(data, dialog.prospectId, () => setDialog(null), refreshAfterChange)
              : null}
          </>
        )}
      </AdminSnapshotBoundary>
    </div>
  );
}

function renderReassign(
  snapshot: AdminSnapshot,
  prospectId: string,
  onClose: () => void,
  onDone: () => void
) {
  const prospect = snapshot.prospects.find((item) => item.id === prospectId);
  if (!prospect) return null;
  return (
    <ReassignDialog
      prospect={prospect}
      agents={snapshot.agents}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

interface BoardContentProps {
  snapshot: AdminSnapshot;
  board:
    | { status: 'loading' }
    | { status: 'ready'; data: AssignmentBoard }
    | { status: 'error'; message: string };
  tab: AssignmentTab;
  onTabChange: (tab: AssignmentTab) => void;
  onRetry: () => void;
  onReassign: (prospectId: string) => void;
}

function BoardContent({
  snapshot,
  board,
  tab,
  onTabChange,
  onRetry,
  onReassign,
}: BoardContentProps) {
  if (board.status === 'loading') {
    return <StatusMessage tone="loading" title="Cargando asignaciones..." />;
  }
  if (board.status === 'error') {
    return (
      <StatusMessage
        tone="error"
        title="No se pudieron cargar las asignaciones."
        description={board.message}
        action={
          <Button variant="secondary" onClick={onRetry}>
            <RotateCcw size={16} aria-hidden="true" />
            Intentar de nuevo
          </Button>
        }
      />
    );
  }

  const views = buildAssignmentViews(snapshot, board.data);
  const counts: Partial<Record<AssignmentTab, number>> = {
    waiting: views.waiting.length,
    assigned: views.assigned.length,
    overdue: views.overdue.length,
  };

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="Vistas de asignación" className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            onClick={() => onTabChange(item)}
            className={cx(
              'inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors duration-150',
              tab === item
                ? 'border-plw-navy bg-plw-navy text-white'
                : 'border-neutral-200 bg-white text-neutral-700 hover:border-plw-gold hover:text-plw-navy'
            )}
          >
            {TAB_LABELS[item]}
            {counts[item] !== undefined ? (
              <span
                className={cx(
                  'rounded-full px-2 text-xs',
                  tab === item ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-600'
                )}
              >
                {counts[item]}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {renderTab(tab, snapshot, views, onReassign)}
    </div>
  );
}

function renderTab(
  tab: AssignmentTab,
  snapshot: AdminSnapshot,
  views: AssignmentViews,
  onReassign: (prospectId: string) => void
) {
  switch (tab) {
    case 'waiting':
      return (
        <AssignmentRows
          rows={views.waiting}
          emptyTitle="No hay consultas esperando asignación."
          actionLabel="Asignar"
          onAction={onReassign}
        />
      );
    case 'assigned':
      return (
        <AssignmentRows
          rows={views.assigned}
          emptyTitle="Todavía no hay prospectos asignados."
          actionLabel="Reasignar"
          onAction={onReassign}
        />
      );
    case 'overdue':
      return (
        <AssignmentRows
          rows={views.overdue}
          emptyTitle="No hay conversaciones vencidas."
          actionLabel="Reasignar"
          onAction={onReassign}
        />
      );
    case 'workload':
      return (
        <div className="grid gap-4 md:grid-cols-3">
          {computeAgentWorkloads(snapshot, new Date()).map((workload) => (
            <AgentWorkloadCard key={workload.agent.id} workload={workload} />
          ))}
        </div>
      );
    case 'history':
      return (
        <AssignmentRows rows={views.history} emptyTitle="Todavía no hay movimientos registrados." />
      );
  }
}
