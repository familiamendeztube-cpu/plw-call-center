import { useState } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import { useAsync } from '@/app/useAsync';
import { formatDateTime } from '@/app/dates';
import { Badge } from '@/components/ui/Badge';
import { Drawer } from '@/components/ui/Drawer';
import { AiCallPanel } from '@/features/ai-calls/components/AiCallSections';
import { loadPhoneRecords } from '@/features/admin/services/phoneRecords';
import type { AdminSnapshot } from '@/features/admin/models/overview';
import { FOLLOWUP_KIND_LABELS } from '@/features/followups/models/followup';
import { ConversationPane } from '@/features/inbox/components/ConversationPane';
import { WhatsAppConversation } from '@/features/whatsapp/components/WhatsAppConversation';
import { DraftTabs } from '@/features/site-draft/components/DraftTabs';
import {
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  SALES_STAGE_LABELS,
  type PaymentStatus,
  type Prospect,
} from '@/features/leads/models/prospect';
import { formatCallDuration } from '@/features/telephony/models/call';

interface AdminCustomerDrawerProps {
  prospect: Prospect;
  snapshot: AdminSnapshot;
  agentNames: Record<string, string>;
  onClose: () => void;
  /** The payment changed: the table refreshes. */
  onChanged: () => void;
}

/**
 * Everything about one customer, for the administrator: details, payment, follow-ups, calls,
 * and the conversation with private notes. Read-only except the payment, which only the
 * administrator records. WhatsApp chats are read in Chatwoot.
 */
export function AdminCustomerDrawer({
  prospect: initial,
  snapshot,
  agentNames,
  onClose,
  onChanged,
}: AdminCustomerDrawerProps) {
  const { leads } = useAppServices();
  const [prospect, setProspect] = useState(initial);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const conversation = snapshot.conversations
    .filter((item) => item.prospectId === prospect.id)
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))[0];
  const followups = snapshot.followups
    .filter((item) => item.prospectId === prospect.id)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const calls = useAsync(
    () => (prospect.phone ? loadPhoneRecords(90, prospect.phone) : Promise.resolve([])),
    [prospect.phone]
  );

  const changePayment = async (status: PaymentStatus) => {
    setPaymentError(null);
    try {
      setProspect(await leads.setPaymentStatus(prospect.id, status));
      onChanged();
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : 'No se pudo guardar el pago.');
    }
  };

  const facts: [string, string][] = [
    ['Contacto', prospect.contactName],
    ['Teléfono', prospect.phone],
    ['Correo', prospect.email],
    ['Giro del negocio', prospect.businessCategory],
    ['Qué quiere mejorar', prospect.serviceInterest],
    [
      'Responsable',
      prospect.assignedAgentId ? (agentNames[prospect.assignedAgentId] ?? '') : 'Sin asignar',
    ],
    ['Origen', prospect.source],
    ['Registrado', formatDateTime(prospect.createdAt)],
  ];

  return (
    <Drawer open wide side="right" title={prospect.businessName} onClose={onClose}>
      <div className="flex flex-col gap-5 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-plw-ink">{prospect.businessName}</h2>
          <Badge tone="navy">{SALES_STAGE_LABELS[prospect.stage]}</Badge>
        </div>

        <dl className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-x-6 gap-y-2 text-sm">
          {facts
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-neutral-500">{label}</dt>
                <dd className="break-words text-plw-ink">{value}</dd>
              </div>
            ))}
        </dl>

        <label className="flex max-w-xs flex-col gap-1.5 text-sm">
          <span className="font-medium text-neutral-700">Pago</span>
          <select
            value={prospect.paymentStatus}
            onChange={(event) => void changePayment(event.target.value as PaymentStatus)}
            className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-plw-ink"
          >
            {PAYMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PAYMENT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          {paymentError ? (
            <span role="alert" className="text-danger-700">
              {paymentError}
            </span>
          ) : null}
        </label>

        <section aria-label="Seguimientos" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-plw-ink">Seguimientos</h3>
          {followups.length === 0 ? (
            <p className="text-sm text-neutral-500">Sin seguimientos.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {followups.map((item) => (
                <li key={item.id} className={item.completed ? 'text-neutral-500 line-through' : ''}>
                  {formatDateTime(item.dueAt)} · {FOLLOWUP_KIND_LABELS[item.kind]} · {item.title}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Llamadas" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-plw-ink">Llamadas del teléfono · 90 días</h3>
          {calls.state.status === 'error' ? (
            <p className="text-sm text-danger-700">{calls.state.message}</p>
          ) : calls.state.status === 'ready' && calls.state.data.length === 0 ? (
            <p className="text-sm text-neutral-500">Sin llamadas registradas con este número.</p>
          ) : calls.state.status === 'ready' ? (
            <ul className="flex flex-col gap-1 text-sm">
              {calls.state.data.slice(0, 20).map((record, index) => (
                <li key={`${record.linkedId}-${index}`}>
                  {formatDateTime(record.startedAt)} ·{' '}
                  {record.direction === 'outbound' ? 'Saliente' : 'Entrante'} ·{' '}
                  {record.staffId
                    ? (agentNames[record.staffId] ?? record.staffId)
                    : 'Cola o recepcionista IA'}{' '}
                  ·{' '}
                  {record.disposition === 'ANSWERED'
                    ? formatCallDuration(record.talkSeconds)
                    : 'Sin respuesta'}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <AiCallPanel
          prospectId={prospect.id}
          agentNames={agentNames}
          canDial={false}
          className="flex flex-col gap-3"
        />

        {/* Same card the agent sees: the administrator verifies the draft, secretary demo,
            and preview link here, including for the isolated test prospect used for real
            end-to-end checks. */}
        <DraftTabs prospect={prospect} canEdit />

        <section aria-label="Conversación y notas" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-plw-ink">Conversación y notas privadas</h3>
          {prospect.source === 'whatsapp' ? (
            <WhatsAppConversation
              conversationId={prospect.id}
              prospect={prospect}
              agentNames={agentNames}
            />
          ) : conversation ? (
            <div className="h-[28rem] overflow-hidden rounded-lg border border-neutral-200">
              <ConversationPane conversationId={conversation.id} agentNames={agentNames} />
            </div>
          ) : (
            <p className="text-sm text-neutral-500">Este cliente no tiene conversación todavía.</p>
          )}
        </section>
      </div>
    </Drawer>
  );
}
