import { RotateCcw } from 'lucide-react';
import { useAgentSession } from '@/features/auth/hooks/useAgentSession';
import { useActivity } from '@/features/presence/hooks/useActivity';
import { ActivityList } from '@/features/presence/components/ActivityList';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { DemoDataNote } from '@/components/ui/DemoDataNote';

export function ActivityPage() {
  const { agentId } = useAgentSession();
  const { state, reload } = useActivity(agentId);

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Mi actividad"
        description="Registro de tus llamadas, notas, seguimientos y cambios de etapa."
        actions={<DemoDataNote />}
      />
      {state.status === 'loading' ? (
        <StatusMessage tone="loading" title="Cargando actividad..." />
      ) : null}
      {state.status === 'error' ? (
        <StatusMessage
          tone="error"
          title="No se pudo cargar tu actividad."
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
        <ActivityList events={state.data} emptyTitle="Aún no tienes actividad registrada." />
      ) : null}
    </div>
  );
}
