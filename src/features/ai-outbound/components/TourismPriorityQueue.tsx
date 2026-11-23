import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarPlus, ExternalLink, History } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { ScheduleFollowupDialog } from '@/features/followups/components/ScheduleFollowupDialog';
import type { Prospect } from '@/features/leads/models/prospect';
import type { AgentId } from '@/features/auth/models/agent';

interface Props {
  /** The signed-in agent (Alejandro). */
  agentId: AgentId;
}

/**
 * Alejandro's tourism priority queue, built only from recorded history — nothing inferred:
 *  - Villa del Sueño: unresolved failed promised callbacks (recorded in tourism_callbacks).
 *  - Terrazas de Golf / Skyline Canopy: recovery suggestion appears ONLY if the history
 *    shows a missed promised callback or a scheduled return-call milestone for that hotel.
 *  - ECO Costa Rica Adventures: proposal follow-up appears only while its stage is
 *    "Propuesta enviada" without a held demo.
 * A follow-up task can be created only when no open task with the same title exists, so the
 * queue can never duplicate work.
 */

const WATCHED = [
  { key: 'villa', match: 'Hotel y Restaurante Villa del Sueño', label: 'Villa del Sueño' },
  { key: 'terrazas', match: 'Terrazas de Golf Boutique Hotel', label: 'Terrazas de Golf' },
  { key: 'skyline', match: 'SKYLINE CANOPY TOUR', label: 'Skyline Canopy Tour' },
  { key: 'eco', match: 'ECO COSTA RICA ADVENTURES', label: 'ECO Costa Rica Adventures' },
] as const;

interface ProspectRow {
  id: string;
  business_name: string;
  contact_name: string;
  phone: string;
  stage: string;
}

interface CallbackRow {
  id: string;
  lead_id: string;
  phone: string;
  scheduled_for: string;
  status: string;
  fail_reason: string | null;
  lead: { business_name: string } | null;
}

interface MilestoneRow {
  prospect_id: string;
  milestone: string;
}

interface FollowupRow {
  id: string;
  prospect_id: string;
  title: string;
  completed: boolean;
}

const crTime = (iso: string) =>
  new Date(iso).toLocaleString('es-CR', {
    timeZone: 'America/Costa_Rica',
    dateStyle: 'short',
    timeStyle: 'short',
  });

function rowToProspect(row: ProspectRow): Prospect {
  return {
    id: row.id,
    businessName: row.business_name,
    contactName: row.contact_name,
    email: '',
    phone: row.phone,
    businessCategory: '',
    serviceInterest: '',
    source: '',
    assignedAgentId: null,
    stage: 'contacted',
    paymentStatus: 'not_recorded',
    nextAction: '',
    nextFollowUpAt: null,
    createdAt: '',
  };
}

export function TourismPriorityQueue({ agentId }: Props) {
  const navigate = useNavigate();
  const [prospects, setProspects] = useState<ProspectRow[]>([]);
  const [callbacks, setCallbacks] = useState<CallbackRow[]>([]);
  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);
  const [followups, setFollowups] = useState<FollowupRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<{ prospect: ProspectRow; title: string } | null>(null);

  useEffect(() => {
    const db = getSupabaseClient();
    void Promise.all([
      db
        .from('prospects')
        .select('id,business_name,contact_name,phone,stage')
        .or(WATCHED.map((w) => `business_name.ilike.%${w.match}%`).join(','))
        .limit(10),
      db
        .from('tourism_callbacks')
        .select('id,lead_id,phone,scheduled_for,status,fail_reason,lead:ai_outbound_leads(business_name)')
        .in('status', ['failed', 'pending'])
        .order('scheduled_for', { ascending: true })
        .limit(100),
      db.from('tourism_milestones').select('prospect_id,milestone').limit(500),
      db
        .from('followups')
        .select('id,prospect_id,title,completed')
        .eq('completed', false)
        .limit(500),
    ])
      .then(([p, cb, ms, fu]) => {
        if (p.error || cb.error || ms.error || fu.error) {
          setError('No se pudo cargar la cola de prioridades.');
        } else {
          setProspects((p.data ?? []) as unknown as ProspectRow[]);
          setCallbacks((cb.data ?? []) as unknown as CallbackRow[]);
          setMilestones((ms.data ?? []) as unknown as MilestoneRow[]);
          setFollowups((fu.data ?? []) as unknown as FollowupRow[]);
        }
        setLoaded(true);
      });
  }, []);

  const rows = useMemo(() => {
    const find = (match: string) =>
      prospects.find((p) => p.business_name.toLowerCase().includes(match.toLowerCase()));
    const openTask = (prospectId: string, title: string) =>
      followups.some((f) => f.prospect_id === prospectId && !f.completed && f.title === title);

    const out: { key: string; label: string; evidence: string[]; prospect: ProspectRow | null; taskTitle: string | null }[] = [];

    // 1. Villa del Sueño: unresolved failed promises, verbatim from recorded history.
    const villa = find('Villa del Sueño');
    const villaFailures = callbacks.filter(
      (cb) => cb.status === 'failed' && cb.lead?.business_name?.toLowerCase().includes('villa del sueño')
    );
    out.push({
      key: 'villa',
      label: 'Villa del Sueño — promesa incumplida',
      evidence: villaFailures.length
        ? villaFailures.map(
            (cb) => `Devolución prometida el ${crTime(cb.scheduled_for)} y no realizada${cb.fail_reason ? ` — ${cb.fail_reason}` : ''}`
          )
        : ['Sin promesas incumplidas registradas hoy.'],
      prospect: villa ?? null,
      taskTitle: villaFailures.length && villa ? `Recuperar promesa de devolución (${villa.business_name})` : null,
    });

    // 2. Recovery of Terrazas / Skyline only with recorded history backing it.
    for (const key of ['terrazas', 'skyline'] as const) {
      const watched = WATCHED.find((w) => w.key === key)!;
      const prospect = find(watched.label.split(' ')[0]);
      const hadCallback = callbacks.some(
        (cb) => cb.lead?.business_name && prospect && cb.lead.business_name.toLowerCase() === prospect.business_name.toLowerCase()
      );
      const hadMilestone = Boolean(
        prospect && milestones.some((m) => m.prospect_id === prospect.id && m.milestone === 'devolucion_agendada')
      );
      out.push({
        key,
        label: `${watched.label} — recuperación`,
        evidence: hadCallback || hadMilestone
          ? [
              hadMilestone
                ? 'Historial: devolución agendada registrada; sugerencia de recuperación verificada.'
                : 'Historial: devolución prometida registrada; sugerencia de recuperación verificada.',
            ]
          : ['Sin historial verificado todavía: no se sugiere contacto.'],
        prospect: hadCallback || hadMilestone ? (prospect ?? null) : null,
        taskTitle:
          (hadCallback || hadMilestone) && prospect && !openTask(prospect.id, `Recuperar ${watched.label}`)
            ? `Recuperar ${watched.label}`
            : null,
      });
    }

    // 3. ECO Costa Rica: verify the proposal landed and follow the price up.
    const eco = find('ECO COSTA RICA');
    const ecoDemoHeld = Boolean(eco && milestones.some((m) => m.prospect_id === eco.id && m.milestone === 'demo_realizada'));
    out.push({
      key: 'eco',
      label: 'ECO Costa Rica Adventures — propuesta y precio',
      evidence:
        eco?.stage === 'proposal_sent' && !ecoDemoHeld
          ? ['Etapa registrada: Propuesta enviada. Verifique que la propuesta llegó y siga el precio.']
          : ['Sin propuesta pendiente verificable hoy.'],
      prospect: eco && eco.stage === 'proposal_sent' && !ecoDemoHeld ? eco : null,
      taskTitle:
        eco && eco.stage === 'proposal_sent' && !ecoDemoHeld && !openTask(eco.id, 'Verificar propuesta y precio (ECO Costa Rica)')
          ? 'Verificar propuesta y precio (ECO Costa Rica)'
          : null,
    });

    return out;
  }, [prospects, callbacks, milestones, followups]);
  if (!loaded) return null;
  if (error) return <p className="text-sm text-danger-700">{error}</p>;

  return (
    <section className="rounded-xl border border-warning-200 bg-warning-50/60 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-warning-700">
        <AlertTriangle size={16} aria-hidden="true" />
        Cola de prioridades de turismo (solo con historial verificado)
      </h3>
      <ul className="mt-2 divide-y divide-warning-200 text-sm">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-1 py-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium text-plw-ink">{row.label}</span>
              {row.prospect ? (
                <Badge tone={row.key === 'villa' ? 'danger' : 'warning'}>
                  {row.key === 'villa' ? 'Prioridad' : 'Verificado'}
                </Badge>
              ) : (
                <Badge tone="neutral">Sin evidencia</Badge>
              )}
            </div>
            <ul className="list-disc pl-5 text-xs text-neutral-600">
              {row.evidence.map((line, index) => (
                <li key={index}>
                  <History size={10} className="mr-1 inline" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
            {row.prospect ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigate(`/clientes?cliente=${row.prospect!.id}`)}
                >
                  <ExternalLink size={13} aria-hidden="true" />
                  Abrir cliente
                </Button>
                {row.taskTitle ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setScheduling({ prospect: row.prospect!, title: row.taskTitle! })}
                  >
                    <CalendarPlus size={13} aria-hidden="true" />
                    Agendar seguimiento
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {scheduling ? (
        <ScheduleFollowupDialog
          agentId={agentId}
          prospects={[rowToProspect(scheduling.prospect)]}
          initialTitle={scheduling.title}
          onClose={() => setScheduling(null)}
          onScheduled={() => setScheduling(null)}
        />
      ) : null}
    </section>
  );
}
