import { useEffect, useState } from 'react';
import { Phone, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { CampaignDetail } from '@/features/ai-outbound/components/CampaignDetail';
import { CreateCampaignDialog } from '@/features/ai-outbound/components/CreateCampaignDialog';
import { TestCallDialog } from '@/features/ai-outbound/components/TestCallDialog';
import { useOutboundCampaigns } from '@/features/ai-outbound/hooks/useOutboundCampaigns';
import {
  TourismDialerCard,
  type TourismCall,
  type TourismRuntime,
} from '@/features/ai-outbound/components/TourismDialerCard';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { cx } from '@/components/ui/cx';

export function AdminAiOutboundPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tourism, setTourism] = useState<TourismRuntime | null>(null);
  const [tourismError, setTourismError] = useState<string | null>(null);
  const [tourismCalls, setTourismCalls] = useState<TourismCall[]>([]);
  const { state, reload } = useOutboundCampaigns();

  const reloadTourism = () => {
    const supabase = getSupabaseClient();
    void Promise.all([
      supabase
        .from('tourism_dialer_runtime')
        .select('scheduler_ready,paused,last_tick_at,last_error,provider_agent_id,config_verified_at,transfer_uri,dialed_today,daily_cap')
        .eq('id', 1)
        .maybeSingle(),
      supabase
        .from('tourism_calls')
        .select('id,created_at,phone,state,outcome,summary,error,is_test,lead:ai_outbound_leads(business_name)')
        .order('created_at', { ascending: false })
        .limit(10),
    ]).then(([runtime, calls]) => {
      setTourismError(runtime.error ? 'No se pudo leer el estado del marcador de turismo.' : null);
      setTourism((runtime.data as TourismRuntime | null) ?? null);
      setTourismCalls(calls.error ? [] : ((calls.data ?? []) as unknown as TourismCall[]));
    });
  };

  useEffect(() => {
    reloadTourism();
    const timer = setInterval(reloadTourism, 30000);
    return () => clearInterval(timer);
  }, []);

  const campaigns = state.status === 'ready' ? state.data : [];
  const selected = campaigns.find((campaign) => campaign.id === selectedId) ?? campaigns[0] ?? null;

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Marcador IA"
        description="Prepara campañas de llamadas salientes del asistente IA con listas de contactos."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setTesting(true)}>
              <Phone size={16} aria-hidden="true" />
              Llamada de prueba
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" />
              Nueva campaña
            </Button>
          </div>
        }
      />

      <TourismDialerCard
        runtime={tourism}
        runtimeError={tourismError}
        calls={tourismCalls}
        onChanged={reloadTourism}
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
                  'rounded-xl border px-4 py-3 text-left text-sm transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.97]',
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

      <TestCallDialog open={testing} onClose={() => setTesting(false)} />
    </div>
  );
}
