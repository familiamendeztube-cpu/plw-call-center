import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/integrations/supabase/client';

const STAGES = [
  { code: 'material_entregado', label: 'Material entregado' },
  { code: 'devolucion_agendada', label: 'Devolución agendada' },
  { code: 'demo_agendada', label: 'Demo agendada' },
  { code: 'demo_realizada', label: 'Demo realizada' },
] as const;

interface Row {
  milestone: string;
  prospect: { business_name: string } | null;
  created_at: string;
  /** Agreed slot (Demo agendada) when present. */
  due_at: string | null;
}

const crTime = (iso: string) =>
  new Date(iso).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica', dateStyle: 'short', timeStyle: 'short' });

/** Admin counts by stage with a click-to-drilldown listing the businesses behind each count. */
export function TourismMilestoneSummary() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSupabaseClient()
      .from('tourism_milestones')
      .select('milestone,created_at,due_at,prospect:prospects(business_name)')
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data, error: loadError }) => {
        if (loadError) setError('No se pudieron cargar los hitos.');
        else {
          setError(null);
          setRows((data ?? []) as unknown as Row[]);
        }
      });
  }, []);

  if (error) return <p className="text-sm text-danger-700">{error}</p>;
  if (!rows) return null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-plw-ink">Hitos de turismo por etapa</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {STAGES.map((stage) => {
          const stageRows = rows.filter((row) => row.milestone === stage.code);
          if (stageRows.length === 0) return null;
          return (
            <button
              key={stage.code}
              type="button"
              onClick={() => setOpen(open === stage.code ? null : stage.code)}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-plw-ink hover:border-neutral-300"
              aria-pressed={open === stage.code}
            >
              {stage.label}: {stageRows.length}
            </button>
          );
        })}
      </div>
      {open && (
        <ul className="mt-2 divide-y divide-neutral-200 text-sm">
          {rows
            .filter((row) => row.milestone === open)
            .map((row, index) => (
              <li key={index} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                <span className="font-medium text-plw-ink">{row.prospect?.business_name || 'Sin nombre'}</span>
                <span className="text-xs text-neutral-500">
                  {row.milestone === 'demo_agendada' && row.due_at
                    ? `${crTime(row.due_at)} (hora de Costa Rica)`
                    : crTime(row.created_at)}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
