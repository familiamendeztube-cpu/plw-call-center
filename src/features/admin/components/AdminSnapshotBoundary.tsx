import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import type { AsyncState } from '@/app/useAsync';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import type { AdminSnapshot } from '@/features/admin/models/overview';

interface AdminSnapshotBoundaryProps {
  state: AsyncState<AdminSnapshot>;
  reload: () => void;
  children: (snapshot: AdminSnapshot) => ReactNode;
}

export function AdminSnapshotBoundary({ state, reload, children }: AdminSnapshotBoundaryProps) {
  if (state.status === 'loading') {
    return <StatusMessage tone="loading" title="Cargando información del equipo..." />;
  }
  if (state.status === 'error') {
    return (
      <StatusMessage
        tone="error"
        title="No se pudo cargar la información del equipo."
        description={state.message}
        action={
          <Button variant="secondary" size="sm" onClick={reload}>
            <RotateCcw size={14} aria-hidden="true" />
            Reintentar
          </Button>
        }
      />
    );
  }
  return <>{children(state.data)}</>;
}
