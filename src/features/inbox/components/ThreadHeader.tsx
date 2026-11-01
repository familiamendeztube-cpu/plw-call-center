import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StageSelect } from '@/features/leads/components/StageSelect';
import { CustomerDetailsDialog } from '@/features/leads/components/CustomerDetailsDialog';
import type { Prospect } from '@/features/leads/models/prospect';
import { SALES_STAGE_LABELS } from '@/features/leads/models/prospect';

interface ThreadHeaderProps {
  prospect: Prospect;
  ownerName: string;
  onProspectChange: (prospect: Prospect) => void;
}

export function ThreadHeader({ prospect, ownerName, onProspectChange }: ThreadHeaderProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <header className="border-b border-neutral-200 bg-white px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-plw-ink">{prospect.businessName}</h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            {prospect.contactName} · {prospect.phone}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="navy">{SALES_STAGE_LABELS[prospect.stage]}</Badge>
            <span className="text-xs text-neutral-500">Agente: {ownerName}</span>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setDetailsOpen(true)}>
          Ver ficha
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="rounded-lg bg-plw-ivory px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-plw-gold">
            Siguiente acción
          </p>
          <p className="mt-1 text-sm font-medium text-plw-ink">{prospect.nextAction}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-neutral-500">Etapa de venta</p>
          <StageSelect prospect={prospect} onChange={onProspectChange} compact />
        </div>
      </div>

      {detailsOpen ? (
        <CustomerDetailsDialog
          prospect={prospect}
          agentName={ownerName}
          onClose={() => setDetailsOpen(false)}
          onProspectChange={onProspectChange}
        />
      ) : null}
    </header>
  );
}
