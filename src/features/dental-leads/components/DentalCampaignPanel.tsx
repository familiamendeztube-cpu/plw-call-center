import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { StaffAgent } from '@/features/ai-outbound/services/outboundCampaigns';
import { dentalCounts, type DentalCampaign, type DentalLead } from '../models/dentalLead';
import { assignDentalLeads } from '../services/dentalLeads';
export function DentalCampaignPanel({
  campaign,
  leads,
  agents,
  admin,
  reload,
}: {
  campaign: DentalCampaign;
  leads: DentalLead[];
  agents: StaffAgent[];
  admin: boolean;
  reload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const selected = agents.filter((a) => /^(alejandro|valeska)$/i.test(a.display_name.trim()));
  async function assign() {
    setBusy(true);
    setMessage('');
    try {
      const n = await assignDentalLeads(
        campaign.id,
        selected.map((a) => a.id)
      );
      setMessage(`${n} contactos asignados. Se conservaron las asignaciones anteriores.`);
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudo asignar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="grid gap-4 rounded-2xl bg-plw-navy p-5 text-white sm:p-6"
      aria-label="Campaña dental"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{campaign.name}</h2>
          <p className="mt-1 text-sm text-white/80">
            {campaign.concurrent_per_agent} llamadas IA simultáneas por agente · Costa Rica
          </p>
        </div>
        <span className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold">
          {campaign.automation_status === 'not_configured'
            ? 'Marcación IA pendiente'
            : campaign.automation_status}
        </span>
      </div>
      {campaign.planned_start_at && (
        <p className="text-sm">
          Inicio solicitado:{' '}
          {new Intl.DateTimeFormat('es-CR', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: campaign.timezone,
          }).format(new Date(campaign.planned_start_at))}
          . La fecha prevista no activa llamadas.
        </p>
      )}
      <p className="rounded-lg bg-white/10 p-3 text-sm">{campaign.readiness_note}</p>
      {admin && (
        <div className="grid gap-3 sm:grid-cols-2">
          {selected.map((agent) => {
            const counts = dentalCounts(leads.filter((l) => l.owner_staff_id === agent.id));
            return (
              <div key={agent.id} className="rounded-xl bg-white/10 p-4">
                <p className="font-semibold">{agent.display_name}</p>
                <p className="my-2 text-3xl font-bold">
                  {counts.total} <span className="text-sm font-normal">dentistas</span>
                </p>
                <p className="text-xs text-white/80">
                  {counts.pending} pendientes · {counts.interested} interesados · {counts.callback}{' '}
                  por devolver llamada
                </p>
              </div>
            );
          })}
        </div>
      )}
      {admin && leads.some((l) => !l.owner_staff_id && l.status === 'pending') && (
        <Button
          variant="secondary"
          disabled={busy || selected.length !== 2}
          onClick={() => void assign()}
        >
          {busy ? 'Asignando…' : 'Repartir pendientes entre Alejandro y Valeska'}
        </Button>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
