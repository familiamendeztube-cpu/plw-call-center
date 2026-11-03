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
import { AiCallPanel } from '@/features/ai-calls/components/AiCallSections';

const TABS: { id: CustomerTab; label: string }[] = [
  { id: 'correo', label: 'Correo' },
  { id: 'oferta', label: 'Qué ofrecer' },
  { id: 'material', label: 'Presentación y videos' },
];

interface CustomerWorkspaceProps {
  entry: CustomerEntry;
  agentId: AgentId;
  agentNames: Record<string, string>;
}

export function CustomerWorkspace({ entry, agentId, agentNames }: CustomerWorkspaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [scheduling, setScheduling] = useState(false);
  const tab = parseCustomerTab(searchParams.get(CUSTOMER_TAB_PARAM));
  const { prospect, conversation } = entry;

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
      <header className="border-b border-neutral-200 px-5 pt-5">
        <h2 className="text-lg font-semibold text-plw-ink">{prospect.businessName}</h2>
        <p className="text-sm text-neutral-500">{prospect.contactName}</p>
        <div
          role="tablist"
          aria-label="Información del cliente"
          className="-mb-px mt-4 flex gap-1 overflow-x-auto"
        >
          {TABS.map((item) => {
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
              </button>
            );
          })}
        </div>
      </header>

      <AiCallPanel prospectId={prospect.id} agentNames={agentNames} />

      <div
        role="tabpanel"
        id={`customer-panel-${tab}`}
        aria-labelledby={`customer-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto bg-plw-ivory/60"
      >
        {tab === 'correo' ? (
          conversation ? (
            <ConversationPane
              key={conversation.id}
              conversationId={conversation.id}
              agentId={agentId}
              agentNames={agentNames}
            />
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
