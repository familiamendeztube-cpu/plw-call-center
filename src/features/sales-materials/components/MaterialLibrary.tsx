import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useMaterials } from '@/features/sales-materials/hooks/useMaterials';
import { MaterialCard } from '@/features/sales-materials/components/MaterialCard';
import {
  MATERIAL_KIND_LABELS,
  type MaterialKind,
} from '@/features/sales-materials/models/material';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { StatusMessage } from '@/components/ui/StatusMessage';

const KINDS = Object.keys(MATERIAL_KIND_LABELS) as MaterialKind[];

export function MaterialLibrary() {
  const { state, reload } = useMaterials();
  const [kindFilter, setKindFilter] = useState<MaterialKind | 'all'>('all');

  const visible = useMemo(() => {
    if (state.status !== 'ready') {
      return [];
    }
    return state.data.filter((material) => kindFilter === 'all' || material.kind === kindFilter);
  }, [state, kindFilter]);

  if (state.status === 'loading') {
    return <StatusMessage tone="loading" title="Cargando material comercial..." />;
  }
  if (state.status === 'error') {
    return (
      <StatusMessage
        tone="error"
        title="No se pudo cargar el material comercial."
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

  const chips: { value: MaterialKind | 'all'; label: string }[] = [
    { value: 'all', label: 'Todo' },
    ...KINDS.map((kind) => ({ value: kind, label: MATERIAL_KIND_LABELS[kind] })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div role="group" aria-label="Filtrar material" className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const active = kindFilter === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              aria-pressed={active}
              onClick={() => setKindFilter(chip.value)}
              className={cx(
                'h-8 rounded-full px-3.5 text-sm font-medium transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/50',
                active
                  ? 'bg-plw-navy text-white'
                  : 'bg-white text-neutral-700 ring-1 ring-neutral-200 hover:ring-plw-gold'
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <StatusMessage tone="empty" title="No hay material para este tipo." />
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((material) => (
            <li key={material.id} className="min-w-0">
              <MaterialCard material={material} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
