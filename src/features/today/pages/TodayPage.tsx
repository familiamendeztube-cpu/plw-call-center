import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, Check, Phone, RotateCcw, UserRound } from 'lucide-react';
import { formatDateTime } from '@/app/dates';
import { useAppServices } from '@/app/ServicesContext';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { sparkBurst } from '@/components/ui/motion';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useAuth } from '@/features/auth/context/useAuth';
import { useAgentSession } from '@/features/auth/hooks/useAgentSession';
import { useAiCalls } from '@/features/ai-calls/hooks/useAiCalls';
import { CUSTOMER_PARAM } from '@/features/customers/models/customerLinks';
import { useDentalDialer } from '@/features/dental-leads/hooks/useDentalDialer';
import { useDentalLeads } from '@/features/dental-leads/hooks/useDentalLeads';
import { followUps as annaFollowUps } from '@/features/dental-leads/models/followUps';
import { RescheduleFollowupDialog } from '@/features/followups/components/RescheduleFollowupDialog';
import { useFollowups } from '@/features/followups/hooks/useFollowups';
import type { Followup } from '@/features/followups/models/followup';
import { useConversations } from '@/features/inbox/hooks/useConversations';
import { useAgentProspects } from '@/features/leads/context/agentProspectsContext';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { toCostaRicaNumber } from '@/features/telephony/models/call';
import {
  buildTodayItems,
  TODAY_KIND_LABELS,
  type TodayItem,
  type TodayKind,
} from '@/features/today/models/today';

const KIND_TONES: Record<TodayKind, BadgeTone> = {
  ai_call: 'gold',
  overdue: 'danger',
  unread: 'navy',
  due_today: 'neutral',
  anna_asked: 'warning',
};

export function TodayPage() {
  const { session } = useAuth();
  const production = session?.source === 'production';
  const { agentId } = useAgentSession();
  const { followups: followupService } = useAppServices();
  const prospects = useAgentProspects();
  const followups = useFollowups(agentId);
  const conversations = useConversations(agentId);
  const aiCalls = useAiCalls({ status: 'pending' });
  const dentalLeads = useDentalLeads(production, false);
  const dialer = useDentalDialer(production);
  const [moving, setMoving] = useState<Followup | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const anna = useMemo(
    () =>
      annaFollowUps(
        dentalLeads.leads.filter((lead) => lead.owner_staff_id === agentId),
        dialer.calls.filter((call) => call.staff_id === agentId)
      ),
    [dentalLeads.leads, dialer.calls, agentId]
  );

  const ready = followups.state.status === 'ready' && conversations.state.status === 'ready';
  const items =
    followups.state.status === 'ready' && conversations.state.status === 'ready'
      ? buildTodayItems(
          {
            prospects: prospects.own,
            followups: followups.state.data,
            conversations: conversations.state.data,
            aiCalls: aiCalls.state.status === 'ready' ? aiCalls.state.data : [],
            annaAsked: anna.asked,
          },
          new Date()
        )
      : [];
  const failure = [followups.state, conversations.state].find((state) => state.status === 'error');

  const followupById = (id: string | undefined) =>
    followups.state.status === 'ready'
      ? (followups.state.data.find((item) => item.id === id) ?? null)
      : null;

  const complete = async (followupId: string, origin: DOMRect) => {
    setActionError(null);
    try {
      const updated = await followupService.setCompleted(followupId, true);
      followups.updateData((list) => list.map((item) => (item.id === updated.id ? updated : item)));
      sparkBurst(origin);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo completar.');
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Hoy"
        description="Todo lo que tienes pendiente en un solo lugar, lo más urgente primero."
        actions={<DesktopAlertsButton />}
      />

      {actionError ? (
        <p role="alert" className="text-sm font-medium text-danger-700">
          {actionError}
        </p>
      ) : null}

      {failure && failure.status === 'error' ? (
        <StatusMessage
          tone="error"
          title="No se pudo cargar tu lista de hoy."
          description={failure.message}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                followups.reload();
                conversations.reload();
              }}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Reintentar
            </Button>
          }
        />
      ) : !ready ? (
        <StatusMessage tone="loading" title="Cargando tu lista de hoy..." />
      ) : items.length === 0 ? (
        <StatusMessage
          tone="empty"
          title="Nada pendiente por ahora."
          description="Los mensajes nuevos, las llamadas de la IA y tus seguimientos aparecerán aquí."
        />
      ) : (
        <ul className="flex flex-col gap-2.5" aria-label="Pendientes de hoy">
          {items.map((item) => (
            <TodayRow
              key={item.id}
              item={item}
              onComplete={
                item.followupId ? (origin) => void complete(item.followupId!, origin) : undefined
              }
              onMove={item.followupId ? () => setMoving(followupById(item.followupId)) : undefined}
            />
          ))}
        </ul>
      )}

      {anna.callback.length > 0 ? (
        <p className="text-sm text-neutral-600">
          Anna dejó {anna.callback.length} {anna.callback.length === 1 ? 'dentista' : 'dentistas'}{' '}
          para volver a llamar (buzón de voz o sin respuesta).{' '}
          <Link to="/dentistas" className="font-medium text-plw-navy underline">
            Ver la lista
          </Link>
        </p>
      ) : null}

      {moving ? (
        <RescheduleFollowupDialog
          followup={moving}
          onClose={() => setMoving(null)}
          onSaved={(updated) =>
            followups.updateData((list) =>
              list.map((item) => (item.id === updated.id ? updated : item))
            )
          }
        />
      ) : null}
    </div>
  );
}

function TodayRow({
  item,
  onComplete,
  onMove,
}: {
  item: TodayItem;
  /** `origin` is where the button was: the row leaves the list once it's done. */
  onComplete?: (origin: DOMRect) => void;
  onMove?: () => void;
}) {
  const navigate = useNavigate();
  const { changeDialNumber } = useTelephony();
  const dialable = toCostaRicaNumber(item.phone ?? '');

  return (
    <li className="flex flex-wrap items-start gap-3 rounded-xl border border-neutral-200/80 bg-white px-4 py-3.5 shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={KIND_TONES[item.kind]}>{TODAY_KIND_LABELS[item.kind]}</Badge>
          <time dateTime={item.at} className="text-xs text-neutral-500">
            {formatDateTime(item.at)}
          </time>
        </div>
        <p className="mt-1.5 truncate text-sm font-semibold text-plw-ink">{item.title}</p>
        {item.detail ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-neutral-600">{item.detail}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {dialable ? (
          <Button size="sm" variant="secondary" onClick={() => changeDialNumber(dialable)}>
            <Phone size={14} aria-hidden="true" />
            Marcar
          </Button>
        ) : null}
        {item.prospectId ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate(`/clientes?${CUSTOMER_PARAM}=${item.prospectId}`)}
          >
            <UserRound size={14} aria-hidden="true" />
            Abrir
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => navigate('/dentistas')}>
            Ver en Dentistas
          </Button>
        )}
        {onMove ? (
          <Button size="sm" variant="ghost" onClick={onMove}>
            <CalendarClock size={14} aria-hidden="true" />
            Reprogramar
          </Button>
        ) : null}
        {onComplete ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => onComplete(event.currentTarget.getBoundingClientRect())}
          >
            <Check size={14} aria-hidden="true" />
            Hecho
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Desktop alerts need the agent's permission once, from a click. */
function DesktopAlertsButton() {
  const supported = typeof Notification !== 'undefined';
  const [permission, setPermission] = useState(supported ? Notification.permission : 'denied');
  if (!supported || permission !== 'default') return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void Notification.requestPermission().then(setPermission)}
    >
      <Bell size={14} aria-hidden="true" />
      Activar avisos en el escritorio
    </Button>
  );
}
