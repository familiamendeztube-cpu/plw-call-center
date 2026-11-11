import { ExternalLink, Clock } from 'lucide-react';
import { formatDateTime } from '@/app/dates';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import {
  MATERIAL_KIND_LABELS,
  type SalesMaterial,
} from '@/features/sales-materials/models/material';

interface MaterialCardProps {
  material: SalesMaterial;
}

export function MaterialCard({ material }: MaterialCardProps) {
  const approved = material.approval === 'approved' && material.url !== null;

  return (
    <Panel as="article" className="flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Badge tone="navy">{MATERIAL_KIND_LABELS[material.kind]}</Badge>
        {approved ? null : <Badge tone="warning">Pendiente de configuración</Badge>}
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <h3 className="text-base font-semibold text-plw-ink">{material.title}</h3>
        <p className="text-sm leading-relaxed text-neutral-600">{material.description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-4">
        <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
          <Clock size={12} aria-hidden="true" />
          Actualizado {formatDateTime(material.updatedAt)}
        </span>
        {approved && material.url ? (
          <a
            href={material.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-plw-navy px-3 text-sm font-medium text-white transition-colors hover:bg-plw-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold"
          >
            Abrir material
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        ) : (
          <span className="text-xs text-neutral-500">Disponible tras la aprobación</span>
        )}
      </div>
    </Panel>
  );
}
