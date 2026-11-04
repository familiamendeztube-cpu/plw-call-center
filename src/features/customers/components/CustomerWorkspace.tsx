import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConversationPane } from '@/features/inbox/components/ConversationPane';
import { CustomerOfferPanel } from '@/features/customers/components/CustomerOfferPanel';
import { CustomerMaterialsPanel } from '@/features/customers/components/CustomerMaterialsPanel';
import { ScheduleFollowupDialog } from '@/features/followups/components/ScheduleFollowupDialog';
import {
  CUSTOMER_ACTION_PARAM,
  CUSTOMER_ACTION_SCHEDULE,
  CUSTOMER_TAB_PARAM,
  parseCustomerTab,
  type CustomerTab,
} from '@/features/customers/models/customerLinks';
import type { CustomerEntry } from '@/features/customers/models/customerEntries';
import type { AgentId } from '@/features/auth/models/agent';
import { cx } from '@/components/ui/cx';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { CopyButton } from '@/components/ui/CopyButton';
import { AiCallPanel } from '@/features/ai-calls/components/AiCallSections';
import { WhatsAppConversation } from '@/features/whatsapp/components/WhatsAppConversation';
import { useWhatsAppChat } from '@/features/whatsapp/hooks/useWhatsApp';

type TabItem = { id: CustomerTab; label: string };
const SHARED_TABS: TabItem[] = [
  { id: 'oferta', label: 'Qué ofrecer' },
  { id: 'material', label: 'Presentación y videos' },
];
// The first tab is how the customer arrived: email thread, AI call, or WhatsApp chat.
const EMAIL_TAB: TabItem = { id: 'correo', label: 'Correo' };
const CALL_TAB: TabItem = { id: 'llamada', label: 'Llamada' };
const WHATSAPP_TAB: TabItem = { id: 'whatsapp', label: 'WhatsApp' };

interface CustomerWorkspaceProps {
  entry: CustomerEntry;
  agentId: AgentId;
  agentNames: Record<string, string>;
}

export function CustomerWorkspace({ entry, agentId, agentNames }: CustomerWorkspaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [scheduling, setScheduling] = useState(false);
  const { prospect, conversation } = entry;
  const fromCall = prospect.source === 'ai_call';
  const fromWhatsApp = prospect.source === 'whatsapp';
  // An email or call customer who later wrote on WhatsApp gets a WhatsApp tab too.
  const { chat, markRead } = useWhatsAppChat(prospect.id, conversation?.lastMessageAt);
  const tabs = fromWhatsApp
    ? [WHATSAPP_TAB, ...SHARED_TABS]
    : [fromCall ? CALL_TAB : EMAIL_TAB, ...(chat ? [WHATSAPP_TAB] : []), ...SHARED_TABS];
  const firstTab = tabs[0].id;
  const requested = parseCustomerTab(searchParams.get(CUSTOMER_TAB_PARAM));
  // A link to a tab this customer does not have (e.g. "correo" for a call) opens the first one.
  const tab = tabs.some((item) => item.id === requested) ? requested : firstTab;
  const callDetails = fromCall ? (
    <AiCallPanel prospectId={prospect.id} agentNames={agentNames} className="flex flex-col gap-3" />
  ) : undefined;

  useEffect(() => {
    if (searchParams.get(CUSTOMER_ACTION_PARAM) !== CUSTOMER_ACTION_SCHEDULE) return;
    setScheduling(true);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(CUSTOMER_ACTION_PARAM);
        return next;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams]);

  const selectTab = (next: CustomerTab) => {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        params.set(CUSTOMER_TAB_PARAM, next);
        return params;
      },
      { replace: true }
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="border-b border-neutral-200 px-5 pt-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-lg font-semibold text-plw-ink">{prospect.businessName}</h2>
          <p className="text-sm text-neutral-500">{prospect.contactName}</p>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm xl:grid-cols-4">
          {prospect.phone ? (
            <div>
              <dt className="text-xs text-neutral-500">Teléfono</dt>
              <dd className="flex flex-wrap items-center gap-2 font-medium text-plw-ink">
                {prospect.phone}
                <CopyButton value={prospect.phone} label={`Copiar el número ${prospect.phone}`} />
              </dd>
            </div>
          ) : null}
          {prospect.email ? (
            <div>
              <dt className="text-xs text-neutral-500">Correo</dt>
              <dd className="line-clamp-2 break-all text-plw-ink" title={prospect.email}>
                {prospect.email}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-neutral-500">Giro del negocio</dt>
            <dd className="line-clamp-2 text-plw-ink" title={prospect.businessCategory}>
              {prospect.businessCategory || 'Sin definir'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Qué quiere mejorar</dt>
            <dd className="line-clamp-2 text-plw-ink" title={prospect.serviceInterest}>
              {prospect.serviceInterest || 'Sin definir'}
            </dd>
          </div>
        </dl>
        <div
          role="tablist"
          aria-label="Información del cliente"
          className="-mb-px mt-3 flex gap-1 overflow-x-auto"
        >
          {tabs.map((item) => {
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                id={`customer-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`customer-panel-${item.id}`}
                onClick={() => selectTab(item.id)}
                className={cx(
                  'h-11 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/60',
                  active
                    ? 'border-plw-gold text-plw-navy'
                    : 'border-transparent text-neutral-500 hover:text-plw-ink'
                )}
              >
                {item.label}
                {item.id === 'whatsapp' && chat?.unread && !active ? (
                  <span
                    aria-label="Mensaje sin leer"
                    className="ml-1.5 inline-block h-2 w-2 rounded-full bg-plw-gold"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </header>

      {/* An email customer who later phoned the AI: show that call above the tabs, except over
          the WhatsApp chat, which needs the height. */}
      {fromCall || tab === 'whatsapp' ? null : (
        <AiCallPanel prospectId={prospect.id} agentNames={agentNames} />
      )}

      <div
        role="tabpanel"
        id={`customer-panel-${tab}`}
        aria-labelledby={`customer-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto bg-plw-ivory/60"
      >
        {tab === 'whatsapp' ? (
          conversation ? (
            <WhatsAppConversation
              key={conversation.id}
              conversationId={conversation.id}
              prospect={prospect}
              agentId={agentId}
              agentNames={agentNames}
              onRead={markRead}
            />
          ) : (
            <div className="p-6">
              <StatusMessage tone="error" title="No se encontró la conversación de este cliente." />
            </div>
          )
        ) : null}
        {tab === firstTab && tab !== 'whatsapp' ? (
          conversation ? (
            <ConversationPane
              key={conversation.id}
              conversationId={conversation.id}
              agentId={agentId}
              agentNames={agentNames}
              channelDetails={callDetails}
            />
          ) : callDetails ? (
            <div className="p-5">{callDetails}</div>
          ) : (
            <div className="p-6">
              <StatusMessage
                tone="empty"
                title="Este cliente todavía no tiene correos."
                description="Cuando haya una conversación, aparecerá aquí."
              />
            </div>
          )
        ) : null}
        {tab === 'oferta' ? (
          <div className="p-5 sm:p-6">
            <CustomerOfferPanel prospect={prospect} agentId={agentId} />
          </div>
        ) : null}
        {tab === 'material' ? (
          <div className="p-5 sm:p-6">
            <CustomerMaterialsPanel />
          </div>
        ) : null}
      </div>

      {scheduling ? (
        <ScheduleFollowupDialog
          agentId={agentId}
          prospects={[prospect]}
          onClose={() => setScheduling(false)}
          onScheduled={() => setScheduling(false)}
        />
      ) : null}
    </div>
  );
}
