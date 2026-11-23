import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, PackageCheck, PhoneCall, Presentation } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getSupabaseClient } from '@/integrations/supabase/client';

export type TourismMilestoneCode =
  | 'material_entregado'
  | 'devolucion_agendada'
  | 'demo_agendada'
  | 'demo_realizada';

export interface TourismMilestone {
  milestone: TourismMilestoneCode;
  channel: string;
  source: 'auto' | 'manual';
  agent_id: string;
  created_at: string;
  /** Agreed Costa Rica slot as UTC, present on scheduled stages. */
  due_at: string | null;
}

const MILESTONES: { code: TourismMilestoneCode; label: string; Icon: typeof PackageCheck }[] = [
  { code: 'material_entregado', label: 'Material entregado', Icon: PackageCheck },
  { code: 'devolucion_agendada', label: 'Devolución agendada', Icon: PhoneCall },
  { code: 'demo_agendada', label: 'Demo agendada', Icon: CalendarClock },
  { code: 'demo_realizada', label: 'Demo realizada', Icon: Presentation },
];
/** Stages that carry an agreed Costa Rica day and time. */
const SCHEDULED = new Set<TourismMilestoneCode>(['devolucion_agendada', 'demo_agendada']);

/** A datetime-local value is typed in the browser's zone; the agent works in Costa Rica. */
const slotToIso = (value: string) => {
  const parsed = new Date(`${value}:00-06:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

const crTime = (iso: string) =>
  new Date(iso).toLocaleString('es-CR', {
    timeZone: 'America/Costa_Rica',
    dateStyle: 'short',
    timeStyle: 'short',
  });

const CHANNEL_LABELS: Record<string, string> = {
  '': '',
  email: 'correo',
  whatsapp: 'WhatsApp',
  phone: 'teléfono',
};

async function loadMilestones(prospectId: string): Promise<TourismMilestone[]> {
  const { data, error } = await getSupabaseClient()
    .from('tourism_milestones')
    .select('milestone,channel,source,agent_id,created_at,due_at')
    .eq('prospect_id', prospectId);
  if (error) throw new Error('No se pudieron cargar los hitos.');
  return (data ?? []) as unknown as TourismMilestone[];
}

interface Props {
  prospectId: string;
  /** The signed-in agent; the administrator sees the milestones but cannot add them here. */
  agentId?: string;
}

export function TourismMilestones({ prospectId, agentId }: Props) {
  const [milestones, setMilestones] = useState<TourismMilestone[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<TourismMilestoneCode | null>(null);

  const reload = useCallback(() => {
    loadMilestones(prospectId)
      .then((rows) => {
        setMilestones(rows);
        setError(null);
      })
      .catch(() => setError('No se pudieron cargar los hitos.'));
  }, [prospectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const add = (code: TourismMilestoneCode, dueAt?: string) => {
    setBusy(code);
    getSupabaseClient()
      .rpc('add_tourism_milestone', {
        p_prospect_id: prospectId,
        p_milestone: code,
        p_channel: '',
        ...(code === 'demo_agendada' ? { p_due_at: dueAt } : {}),
      })
      .then(({ error: rpcError }) => {
        if (rpcError) setError(rpcError.message || 'No se pudo registrar el hito.');
        else {
          setError(null);
          reload();
        }
      })
      .finally(() => setBusy(null));
  };

  const done = new Map((milestones ?? []).map((row) => [row.milestone, row]));

  return (
    <section aria-label="Hitos del cliente" className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-plw-ink">Hitos</h3>
      {error && <p className="mt-1 text-xs text-danger-700">{error}</p>}
      <ul className="mt-2 flex flex-col gap-2">
        {MILESTONES.map(({ code, label, Icon }) => {
          const row = done.get(code);
          return (
            <li key={code} className="flex items-center gap-2 text-sm">
              <Icon size={16} aria-hidden="true" className={row ? 'text-success-700' : 'text-neutral-300'} />
              <span className={row ? 'font-medium text-plw-ink' : 'text-neutral-500'}>{label}</span>
              {row ? (
                <span className="text-xs text-neutral-500">
                  {SCHEDULED.has(code) && row.due_at
                    ? `${crTime(row.due_at)} (hora de Costa Rica)`
                    : crTime(row.created_at)}
                  {CHANNEL_LABELS[row.channel] ? ` · por ${CHANNEL_LABELS[row.channel]}` : ''}
                  {row.source === 'auto' ? ' · automático' : ''}
                </span>
              ) : code === 'demo_agendada' && agentId ? (
                <form
                  className="ml-auto flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = new FormData(event.currentTarget).get('demo_slot');
                    if (typeof value === 'string' && value) add(code, slotToIso(value));
                  }}
                >
                  <input
                    name="demo_slot"
                    type="datetime-local"
                    required
                    aria-label="Fecha y hora de la demo"
                    className="rounded-lg border border-neutral-300 px-2 py-1 text-xs text-plw-ink"
                  />
                  <Button type="submit" size="sm" variant="ghost" disabled={busy !== null}>
                    <CheckCircle2 size={14} aria-hidden="true" />
                    {busy === code ? 'Registrando…' : 'Registrar'}
                  </Button>
                </form>
              ) : agentId ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={busy !== null}
                  onClick={() => add(code)}
                >
                  <CheckCircle2 size={14} aria-hidden="true" />
                  {busy === code ? 'Registrando…' : 'Registrar'}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
