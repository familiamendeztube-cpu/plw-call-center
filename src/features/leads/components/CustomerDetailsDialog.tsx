import type { ReactNode } from 'react';
import { PAYMENT_STATUS_LABELS, type Prospect } from '@/features/leads/models/prospect';
import { formatDateTime } from '@/app/dates';
import { Dialog } from '@/components/ui/Dialog';
import { StageSelect } from '@/features/leads/components/StageSelect';
import { Badge } from '@/components/ui/Badge';

interface CustomerDetailsDialogProps {
  prospect: Prospect | null;
  agentName: string;
  onClose: () => void;
  onProspectChange: (prospect: Prospect) => void;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-neutral-500">{label}</dt>
      <dd className="text-sm font-medium text-plw-ink">{children}</dd>
    </div>
  );
}

export function CustomerDetailsDialog({
  prospect,
  agentName,
  onClose,
  onProspectChange,
}: CustomerDetailsDialogProps) {
  if (!prospect) {
    return null;
  }

  return (
    <Dialog
      open
      title={prospect.businessName}
      description="Ficha del prospecto"
      onClose={onClose}
      widthClass="max-w-2xl"
    >
      <div className="flex flex-col gap-6">
        <StageSelect prospect={prospect} onChange={onProspectChange} />
        <dl className="divide-y divide-neutral-200 border-y border-neutral-200">
          <DetailRow label="Contacto">{prospect.contactName}</DetailRow>
          <DetailRow label="Correo">{prospect.email}</DetailRow>
          <DetailRow label="Teléfono">{prospect.phone}</DetailRow>
          <DetailRow label="Categoría">{prospect.businessCategory}</DetailRow>
          <DetailRow label="Interés">{prospect.serviceInterest}</DetailRow>
          <DetailRow label="Agente asignado">{agentName}</DetailRow>
          <DetailRow label="Pago">
            <Badge tone={prospect.paymentStatus === 'paid' ? 'success' : 'neutral'}>
              {PAYMENT_STATUS_LABELS[prospect.paymentStatus]}
            </Badge>
          </DetailRow>
          <DetailRow label="Próximo seguimiento">
            {prospect.nextFollowUpAt ? formatDateTime(prospect.nextFollowUpAt) : 'Sin programar'}
          </DetailRow>
          <DetailRow label="Creado">{formatDateTime(prospect.createdAt)}</DetailRow>
        </dl>
      </div>
    </Dialog>
  );
}
