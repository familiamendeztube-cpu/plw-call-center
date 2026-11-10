import { useState } from 'react';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useCampaignAgentIds, useEnabledAgents } from '@/features/ai-outbound/hooks/useOutboundCampaigns';
import { setCampaignAgent } from '@/features/ai-outbound/services/outboundCampaigns';

interface CampaignAgentsPanelProps {
  campaignId: string;
}

export function CampaignAgentsPanel({ campaignId }: CampaignAgentsPanelProps) {
  const agents = useEnabledAgents();
  const selected = useCampaignAgentIds(campaignId);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (agents.state.status === 'loading' || selected.state.status === 'loading') {
    return <StatusMessage tone="loading" title="Cargando agentes..." />;
  }
  if (agents.state.status === 'error') {
    return <StatusMessage tone="error" title={agents.state.message} />;
  }
  if (selected.state.status === 'error') {
    return <StatusMessage tone="error" title={selected.state.message} />;
  }

  const selectedIds = new Set(selected.state.data);

  const toggle = async (staffId: string, checked: boolean) => {
    setPendingId(staffId);
    setError(null);
    try {
      await setCampaignAgent(campaignId, staffId, checked);
      selected.updateData((ids) => (checked ? [...ids, staffId] : ids.filter((id) => id !== staffId)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el agente de la campaña.');
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-plw-ink">Agentes participantes</h3>
      {agents.state.data.length === 0 ? (
        <p className="text-sm text-neutral-500">No hay agentes habilitados.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {agents.state.data.map((agent) => (
            <li key={agent.id}>
              <label className="flex items-center gap-3 rounded-lg border border-neutral-200 px-4 py-3 text-sm transition-colors hover:border-neutral-300">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selectedIds.has(agent.id)}
                  disabled={pendingId === agent.id}
                  onChange={(event) => void toggle(agent.id, event.target.checked)}
                />
                <span className="text-plw-ink">{agent.display_name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
