import { useState } from 'react';
import { PrivateNoteComposer } from '@/features/leads/components/PrivateNoteComposer';
import {
  PAYMENT_STATUS_LABELS,
  SALES_STAGE_LABELS,
  type Prospect,
} from '@/features/leads/models/prospect';
import { formatDateTime } from '@/app/dates';
import { Panel } from '@/components/ui/Panel';
import type { AgentId } from '@/features/auth/models/agent';

interface CustomerOfferPanelProps {
  prospect: Prospect;
  agentId: AgentId;
}

interface FactProps {
  label: string;
  value: string;
}

function Fact({ label, value }: FactProps) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{label}</dt>
      <dd className="text-sm leading-relaxed text-plw-ink">{value}</dd>
    </div>
  );
}

export function CustomerOfferPanel({ prospect, agentId }: CustomerOfferPanelProps) {
  const [noteSaved, setNoteSaved] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <Panel className="p-5">
        <dl className="grid gap-5 sm:grid-cols-2">
          <Fact label="Lo que le interesa" value={prospect.serviceInterest || 'Sin definir'} />
          <Fact label="Giro del negocio" value={prospect.businessCategory || 'Sin definir'} />
          <Fact label="Etapa" value={SALES_STAGE_LABELS[prospect.stage]} />
          <Fact label="Pago" value={PAYMENT_STATUS_LABELS[prospect.paymentStatus]} />
          <Fact
            label="Próximo seguimiento"
            value={
              prospect.nextFollowUpAt ? formatDateTime(prospect.nextFollowUpAt) : 'Sin agendar'
            }
          />
        </dl>
      </Panel>

      <Panel className="flex flex-col gap-3 p-5">
        <div>
          <h3 className="text-sm font-semibold text-plw-ink">Nota privada</h3>
          <p className="text-xs text-neutral-500">
            Solo tú y el equipo la ven. El cliente no recibe esta nota.
          </p>
        </div>
        <PrivateNoteComposer
          prospectId={prospect.id}
          agentId={agentId}
          onSaved={() => setNoteSaved(true)}
        />
        {noteSaved ? (
          <p role="status" className="text-xs font-medium text-success-700">
            Nota guardada. Solo tu equipo puede verla.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
