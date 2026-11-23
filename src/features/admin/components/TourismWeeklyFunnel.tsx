import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { getSupabaseClient } from '@/integrations/supabase/client';

/**
 * Admin weekly funnel for the Costa Rica tourism campaign, backed by recorded evidence
 * only — nothing inferred or guessed:
 *  - Decision-makers reached: completed tourism calls whose structured details captured a
 *    decision-maker contact (plw_decision_maker / plw_reached_decision_maker), unique per phone.
 *  - Demos booked: 'demo_agendada' milestones created this week (evidence = milestone row).
 *  - Demos held: 'demo_realizada' milestones created this week.
 *  - Paid starts: prospects whose payment_status moved to 'paid' this week (evidence =
 *    activity event; a changed status alone never counts as a payment).
 */

interface Row {
  milestone: string | null;
  created_at: string;
  prospect_id: string;
  prospect: { business_name: string } | null;
}

interface CallRow {
  id: string;
  phone: string;
  created_at: string;
  outcome: string | null;
  details: Record<string, unknown> | null;
}

interface ActivityRow {
  id: string;
  prospect_id: string | null;
  summary: string;
  occurred_at: string;
  prospect: { business_name: string } | null;
}

const MS_WEEK = 7 * 24 * 60 * 60 * 1000;

const reachedDecisionMaker = (call: CallRow) => {
  const details = call.details ?? {};
  return details['plw_decision_maker'] || details['plw_reached_decision_maker'];
};

export function TourismWeeklyFunnel() {
  const [reached, setReached] = useState<string[] | null>(null);
  const [booked, setBooked] = useState<Row[]>([]);
  const [held, setHeld] = useState<Row[]>([]);
  const [paid, setPaid] = useState<ActivityRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const since = new Date(Date.now() - MS_WEEK).toISOString();
    const db = getSupabaseClient();
    void Promise.all([
      db
        .from('tourism_calls')
        .select('id,phone,created_at,outcome,details')
        .eq('is_test', false)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500),
      db
        .from('tourism_milestones')
        .select('milestone,created_at,prospect_id,prospect:prospects(business_name)')
        .in('milestone', ['demo_agendada', 'demo_realizada'])
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500),
      // set_payment_status writes "Pago confirmado..." when a customer moves to paid; only
      // tourism customers (created by the dialer with a 'tourism:' key) count here.
      db
        .from('activity_events')
        .select('id,prospect_id,summary,occurred_at,prospect:prospects!inner(idempotency_key,business_name)')
        .ilike('summary', 'Pago confirmado%')
        .like('prospect.idempotency_key', 'tourism:%')
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: false })
        .limit(200),
    ]).then(([calls, ms, acts]) => {
      if (calls.error || ms.error || acts.error) {
        setError('No se pudo cargar el embudo semanal.');
        return;
      }
      const callRows = ((calls.data ?? []) as unknown as CallRow[]).filter(
        (row) => row.outcome !== 'TECHNICAL_FAILURE' && row.outcome !== 'NO_ANSWER'
      );
      // Unique decision-makers by phone — a repeated call to the same number counts once.
      const seen = new Set<string>();
      for (const call of callRows) {
        if (reachedDecisionMaker(call)) seen.add(call.phone);
      }
      setReached([...seen]);
      const milestoneRows = (ms.data ?? []) as unknown as Row[];
      setBooked(milestoneRows.filter((row) => row.milestone === 'demo_agendada'));
      setHeld(milestoneRows.filter((row) => row.milestone === 'demo_realizada'));
      setPaid((acts.data ?? []) as unknown as ActivityRow[]);
    });
  }, []);

  if (error) return <p className="text-sm text-danger-700">{error}</p>;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-plw-ink">
        <BarChart3 size={16} className="text-plw-navy" aria-hidden="true" />
        Embudo de turismo — últimos 7 días (Costa Rica)
      </h3>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Decisores alcanzados', value: reached?.length ?? 0, hint: 'Llamadas con decisor identificado, únicas por teléfono' },
          { label: 'Demos agendadas', value: booked.length, hint: 'Hitos "Demo agendada" de la semana' },
          { label: 'Demos realizadas', value: held.length, hint: 'Hitos "Demo realizada" de la semana' },
          { label: 'Inicios pagados', value: paid.length, hint: 'Solo pagos confirmados en el registro' },
        ].map((cell) => (
          <div key={cell.label} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-2xl font-semibold text-plw-ink">{cell.value}</p>
            <p className="text-xs font-medium text-neutral-700">{cell.label}</p>
            <p className="mt-0.5 text-[11px] text-neutral-500">{cell.hint}</p>
          </div>
        ))}
      </div>
      {(booked.length > 0 || held.length > 0 || paid.length > 0) && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-plw-navy">Ver detalle</summary>
          <ul className="mt-2 divide-y divide-neutral-200 text-sm">
            {booked.map((row, index) => (
              <li key={`b${index}`} className="py-1.5 text-neutral-700">
                Demo agendada — {row.prospect?.business_name || 'Sin nombre'}
              </li>
            ))}
            {held.map((row, index) => (
              <li key={`h${index}`} className="py-1.5 text-neutral-700">
                Demo realizada — {row.prospect?.business_name || 'Sin nombre'}
              </li>
            ))}
            {paid.map((row) => (
              <li key={row.id} className="py-1.5 text-neutral-700">
                Pago confirmado — {row.prospect?.business_name || 'Sin nombre'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
