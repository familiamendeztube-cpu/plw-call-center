import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { CampaignDetail } from '@/features/ai-outbound/components/CampaignDetail';
import { CreateCampaignDialog } from '@/features/ai-outbound/components/CreateCampaignDialog';
import { useOutboundCampaigns } from '@/features/ai-outbound/hooks/useOutboundCampaigns';
import { cx } from '@/components/ui/cx';

export function AdminAiOutboundPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { state, reload } = useOutboundCampaigns();

  const campaigns = state.status === 'ready' ? state.data : [];
  const selected = campaigns.find((campaign) => campaign.id === selectedId) ?? campaigns[0] ?? null;

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Marcador IA"
        description="Prepara campañas de llamadas salientes del asistente IA con listas de contactos."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" />
            Nueva campaña
          </Button>
        }
      />

      {state.status === 'loading' ? (
        <StatusMessage tone="loading" title="Cargando campañas..." />
      ) : state.status === 'error' ? (
        <StatusMessage tone="error" title={state.message} />
      ) : campaigns.length === 0 ? (
        <StatusMessage
          tone="empty"
          title="Aún no hay campañas."
          description="Crea una campaña y luego importa tu lista de contactos."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <nav aria-label="Campañas" className="flex flex-col gap-2">
            {campaigns.map((campaign) => (
              <button
                key={campaign.id}
                type="button"
                onClick={() => setSelectedId(campaign.id)}
                aria-current={selected?.id === campaign.id ? 'true' : undefined}
                className={cx(
                  'rounded-xl border px-4 py-3 text-left text-sm transition-colors',
                  selected?.id === campaign.id
                    ? 'border-plw-deep bg-white font-semibold text-plw-ink shadow-raised'
                    : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300'
                )}
              >
                {campaign.name}
              </button>
            ))}
          </nav>
          {selected ? (
            <CampaignDetail
              key={selected.id}
              campaign={selected}
              onDeleted={() => {
                setSelectedId(null);
                reload();
              }}
            />
          ) : null}
        </div>
      )}

      <CreateCampaignDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={reload}
      />
    </div>
  );
}
