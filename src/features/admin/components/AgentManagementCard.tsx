import { KeyRound, Phone, Power, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import type { AdminAgent } from '@/features/admin/models/adminAgents';

interface AgentManagementCardProps {
  agent: AdminAgent;
  hasPhone: boolean;
  onEditProfile: () => void;
  onChangePin: () => void;
  onSetPhone: () => void;
  onRevokeSessions: () => void;
}

export function AgentManagementCard({
  agent,
  hasPhone,
  onEditProfile,
  onChangePin,
  onSetPhone,
  onRevokeSessions,
}: AgentManagementCardProps) {
  const capacity =
    agent.maxActiveProspects === null
      ? 'Sin límite de conversaciones'
      : `Hasta ${agent.maxActiveProspects} conversaciones activas`;

  return (
    <Panel as="article" className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-plw-ivory text-plw-navy">
          <UserRound size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-plw-ink">{agent.displayName}</h3>
          <p className="text-xs text-neutral-500">{capacity}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {agent.isEnabled ? (
          <Badge tone="success">Habilitado</Badge>
        ) : (
          <Badge tone="danger">Deshabilitado</Badge>
        )}
        {agent.hasPin ? (
          <Badge tone="navy">PIN configurado</Badge>
        ) : (
          <Badge tone="warning">Sin PIN</Badge>
        )}
        {hasPhone ? (
          <Badge tone="navy">Teléfono asignado</Badge>
        ) : (
          <Badge tone="warning">Sin teléfono</Badge>
        )}
      </div>

      <div className="mt-auto grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
        <Button variant="secondary" size="sm" onClick={onEditProfile}>
          <UserRound size={14} aria-hidden="true" />
          Editar
        </Button>
        <Button variant="secondary" size="sm" onClick={onChangePin}>
          <KeyRound size={14} aria-hidden="true" />
          {agent.hasPin ? 'Cambiar PIN' : 'Crear PIN'}
        </Button>
        <Button variant="secondary" size="sm" onClick={onSetPhone}>
          <Phone size={14} aria-hidden="true" />
          Teléfono
        </Button>
        <Button variant="ghost" size="sm" onClick={onRevokeSessions}>
          <Power size={14} aria-hidden="true" />
          Cerrar sesiones
        </Button>
      </div>
    </Panel>
  );
}
