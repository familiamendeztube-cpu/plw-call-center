import { useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Badge } from '@/components/ui/Badge';
import { ImportLeadsDialog } from '@/features/ai-outbound/components/ImportLeadsDialog';
import { useCampaignLeads } from '@/features/ai-outbound/hooks/useOutboundCampaigns';
import {
  deleteCampaign,
  deleteLead,
  type OutboundCampaign,
} from '@/features/ai-outbound/services/outboundCampaigns';

interface CampaignDetailProps {
  campaign: OutboundCampaign;
  onDeleted: () => void;
}

export function CampaignDetail({ campaign, onDeleted }: CampaignDetailProps) {
  const [importing, setImporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { state, reload } = useCampaignLeads(campaign.id);

  const handleDeleteLead = async (id: string) => {
    setActionError(null);
    try {
      await deleteLead(id);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo eliminar el contacto.');
    }
  };

  const handleDeleteCampaign = async () => {
    if (!window.confirm(`¿Eliminar la campaña "${campaign.name}" y todos sus contactos?`)) return;
    setActionError(null);
    try {
      await deleteCampaign(campaign.id);
      onDeleted();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo eliminar la campaña.');
    }
  };

  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-neutral-200 bg-white p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-plw-ink">{campaign.name}</h2>
            <Badge tone="neutral">Sin iniciar</Badge>
          </div>
          {campaign.purpose ? (
            <p className="mt-1 text-sm text-neutral-600">{campaign.purpose}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <Upload size={16} aria-hidden="true" />
            Importar contactos
          </Button>
          <Button variant="danger" onClick={() => void handleDeleteCampaign()}>
            Eliminar campaña
          </Button>
        </div>
      </header>

      <p className="rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
        El marcado automático todavía no está activo. Puedes preparar y revisar la lista de
        contactos; las llamadas no se iniciarán hasta que se active el marcador.
      </p>

      {actionError ? (
        <p role="alert" className="text-sm text-danger-700">
          {actionError}
        </p>
      ) : null}

      {state.status === 'loading' ? (
        <StatusMessage tone="loading" title="Cargando contactos..." />
      ) : state.status === 'error' ? (
        <StatusMessage tone="error" title={state.message} />
      ) : state.data.length === 0 ? (
        <StatusMessage
          tone="empty"
          title="Esta campaña no tiene contactos."
          description="Importa una lista para empezar."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Teléfono</th>
                <th className="py-2 pr-4 font-medium">Nombre</th>
                <th className="py-2 pr-4 font-medium">Negocio</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {state.data.map((lead) => (
                <tr key={lead.id}>
                  <td className="py-2 pr-4 font-mono text-plw-ink">{lead.phone}</td>
                  <td className="py-2 pr-4 text-neutral-700">{lead.contact_name || '-'}</td>
                  <td className="py-2 pr-4 text-neutral-700">{lead.business_name || '-'}</td>
                  <td className="py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Eliminar ${lead.phone}`}
                      onClick={() => void handleDeleteLead(lead.id)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm text-neutral-500">Contactos: {state.data.length}</p>
        </div>
      )}

      <ImportLeadsDialog
        open={importing}
        campaignId={campaign.id}
        onClose={() => setImporting(false)}
        onImported={reload}
      />
    </section>
  );
}
