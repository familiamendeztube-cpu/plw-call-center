import type { ReactNode } from 'react';
import { Mail, Phone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppServices } from '@/app/ServicesContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { DemoDataNote } from '@/components/ui/DemoDataNote';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { GmailSyncCard } from '@/features/admin/components/GmailSyncCard';
import { GoogleWorkspaceCard } from '@/features/admin/components/GoogleWorkspaceCard';
import { CONNECTOR_STATUS_LABELS } from '@/features/admin/models/integrations';
import type { TelephonyConnectorStatus } from '@/integrations/telephony/telephonyContract';

export function AdminIntegrationsPage() {
  const { email } = useAppServices();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Integraciones"
        description="Conexiones con correo y telefonía. Las credenciales se configuran en el servidor, nunca en esta pantalla."
        actions={<DemoDataNote />}
      />
      <GoogleWorkspaceCard />
      <GmailSyncCard />
      <div className="grid gap-4 lg:grid-cols-2">
        <IntegrationCard
          icon={Mail}
          title="Correo electrónico"
          description="Envío de mensajes y plantillas aprobadas para los prospectos."
          status={email.status}
          detail="El envío de correos permanece deshabilitado hasta conectar el proveedor."
        />
        <IntegrationCard
          icon={Phone}
          title="Telefonía SIP"
          description="Registro de línea y control de llamadas de los agentes."
          detail="Cada agente usa su propia cuenta de teléfono. Las credenciales de la línea Vocex permanecen solo en el servidor telefónico."
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate('/admin/agentes')}>
              Asignar teléfonos
            </Button>
          }
        />
      </div>
    </div>
  );
}

interface IntegrationCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  status?: TelephonyConnectorStatus;
  detail: string;
  action?: ReactNode;
}

function IntegrationCard({
  icon: Icon,
  title,
  description,
  status,
  detail,
  action,
}: IntegrationCardProps) {
  return (
    <Panel as="article" className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-plw-ivory text-plw-gold">
          <Icon size={20} aria-hidden="true" />
        </span>
        {status ? <Badge tone="warning">{CONNECTOR_STATUS_LABELS[status]}</Badge> : null}
      </div>
      <div>
        <h2 className="text-base font-semibold text-plw-ink">{title}</h2>
        <p className="mt-1 text-sm text-neutral-600">{description}</p>
      </div>
      <p className="rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-600">{detail}</p>
      {action ? <div>{action}</div> : null}
    </Panel>
  );
}
