import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { StageSelect } from '@/features/leads/components/StageSelect';
import { CustomerDetailsDialog } from '@/features/leads/components/CustomerDetailsDialog';
import type { Prospect } from '@/features/leads/models/prospect';

interface ThreadHeaderProps {
  prospect: Prospect;
  ownerName: string;
  onProspectChange: (prospect: Prospect) => void;
}

export function ThreadHeader({ prospect, ownerName, onProspectChange }: ThreadHeaderProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  // One row: the customer's name and contact are already in the page header right above,
  // and every line here is a line less for the messages.
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-200 bg-white px-5 py-2.5">
      <div className="flex items-center gap-2">
        <label
          htmlFor={`stage-${prospect.id}`}
          className="whitespace-nowrap text-xs font-medium text-neutral-500"
        >
          Etapa de venta
        </label>
        <div className="w-48">
          <StageSelect prospect={prospect} onChange={onProspectChange} compact />
        </div>
      </div>
      <span className="text-xs text-neutral-500">Agente: {ownerName}</span>
      <Button
        variant="secondary"
        size="sm"
        className="ml-auto"
        onClick={() => setDetailsOpen(true)}
      >
        Ver ficha
      </Button>

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
