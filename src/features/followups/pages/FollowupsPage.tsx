import { useMemo, useState } from 'react';
import { CalendarPlus, RotateCcw } from 'lucide-react';
import { useAppServices } from '@/app/ServicesContext';
import { useAgentSession } from '@/features/auth/hooks/useAgentSession';
import { useProspects } from '@/features/leads/hooks/useProspects';
import { useFollowups } from '@/features/followups/hooks/useFollowups';
import { FollowupBoard } from '@/features/followups/components/FollowupBoard';
import { ScheduleFollowupDialog } from '@/features/followups/components/ScheduleFollowupDialog';
import type { Followup } from '@/features/followups/models/followup';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { DemoDataNote } from '@/components/ui/DemoDataNote';

export function FollowupsPage() {
  const { followups: followupService } = useAppServices();
  const { agentId } = useAgentSession();
  const { state, reload, updateData } = useFollowups(agentId);
  const prospects = useProspects();
  const [scheduling, setScheduling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const prospectList = useMemo(
    () => (prospects.state.status === 'ready' ? prospects.state.data : []),
    [prospects.state]
  );
  const ownProspects = useMemo(
    () => prospectList.filter((prospect) => prospect.assignedAgentId === agentId),
    [prospectList, agentId]
  );
  const prospectNames = useMemo(
    () => Object.fromEntries(prospectList.map((prospect) => [prospect.id, prospect.businessName])),
    [prospectList]
  );

  const handleToggle = async (followup: Followup) => {
    setActionError(null);
    try {
      const updated = await followupService.setCompleted(followup.id, !followup.completed);
      updateData((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'No se pudo actualizar el seguimiento.'
      );
    }
  };

  const handleScheduled = (followup: Followup) => {
    updateData((items) => [...items, followup]);
  };

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Seguimientos"
        description="Llamadas de regreso, correos y reuniones programadas. Las fechas se muestran en hora de Costa Rica."
        actions={
          <>
            <DemoDataNote />
            <Button onClick={() => setScheduling(true)} disabled={ownProspects.length === 0}>
              <CalendarPlus size={16} aria-hidden="true" />
              Programar seguimiento
            </Button>
          </>
        }
      />

      {actionError ? (
        <p role="alert" className="text-sm font-medium text-danger-700">
          {actionError}
        </p>
      ) : null}

      {state.status === 'loading' ? (
        <StatusMessage tone="loading" title="Cargando seguimientos..." />
      ) : null}
      {state.status === 'error' ? (
        <StatusMessage
          tone="error"
          title="No se pudieron cargar los seguimientos."
          description={state.message}
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              <RotateCcw size={14} aria-hidden="true" />
              Reintentar
            </Button>
          }
        />
      ) : null}
      {state.status === 'ready' ? (
        <FollowupBoard
          followups={state.data}
          prospectNames={prospectNames}
          onToggle={handleToggle}
          now={new Date()}
        />
      ) : null}

      {scheduling ? (
        <ScheduleFollowupDialog
          agentId={agentId}
          prospects={ownProspects}
          onClose={() => setScheduling(false)}
          onScheduled={handleScheduled}
        />
      ) : null}
    </div>
  );
}
