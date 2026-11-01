import { RotateCcw } from 'lucide-react';
import { useMaterials } from '@/features/sales-materials/hooks/useMaterials';
import { MaterialCard } from '@/features/sales-materials/components/MaterialCard';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';

export function CustomerMaterialsPanel() {
  const { state, reload } = useMaterials();

  if (state.status === 'loading') {
    return <StatusMessage tone="loading" title="Cargando presentaciones..." />;
  }
  if (state.status === 'error') {
    return (
      <StatusMessage
        tone="error"
        title="No se pudieron cargar las presentaciones."
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
  if (state.data.length === 0) {
    return (
      <StatusMessage
        tone="empty"
        title="Aún no hay presentaciones ni videos."
        description="El material aprobado aparecerá aquí."
      />
    );
  }

  return (
    <ul className="grid gap-5 sm:grid-cols-2">
      {state.data.map((material) => (
        <li key={material.id} className="min-w-0">
          <MaterialCard material={material} />
        </li>
      ))}
    </ul>
  );
}
