import type { DentalCall } from '../models/dentalDialer';
import {
  DENTAL_RESULT_LABELS,
  dentalResultsByDay,
  type DentalDayResults,
  type DentalResult,
} from '../models/dentalResults';

const RESULTS = Object.keys(DENTAL_RESULT_LABELS) as DentalResult[];

/** Anna's results per day for one agent's dialer: what the list and the script are producing. */
export function DentalResultsTable({ calls }: { calls: DentalCall[] }) {
  const { days, total } = dentalResultsByDay(calls);
  if (total.calls === 0) {
    return <p className="text-sm text-neutral-600">Todavía no hay llamadas terminadas.</p>;
  }

  const row = (day: DentalDayResults, label: string) => (
    <tr key={day.day} className={day.day === 'total' ? 'font-semibold' : undefined}>
      <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium">
        {label}
      </th>
      <td className="px-3 py-2 tabular-nums">{day.calls}</td>
      {RESULTS.map((result) => (
        <td key={result} className="px-3 py-2 tabular-nums">
          {day.results[result] || ''}
        </td>
      ))}
      <td className="px-3 py-2 tabular-nums">{day.transfers || ''}</td>
    </tr>
  );

  return (
    <section aria-labelledby="dental-results-heading" className="flex flex-col gap-2">
      <h2 id="dental-results-heading" className="text-lg font-semibold text-plw-ink">
        Resultados de Anna por día
      </h2>
      <p className="text-sm text-neutral-600">
        Llamadas terminadas, sin pruebas. «Número malo» incluye los números que la red rechazó (SIP
        404) y los equivocados; «Línea no disponible», los ocupados o apagados.
      </p>
      <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-white">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-plw-ivory text-xs uppercase tracking-wide text-neutral-600">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">
                Día
              </th>
              <th scope="col" className="px-3 py-2 text-left">
                Llamadas
              </th>
              {RESULTS.map((result) => (
                <th key={result} scope="col" className="px-3 py-2 text-left">
                  {DENTAL_RESULT_LABELS[result]}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-left">
                Transferidas
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {days.map((day) => row(day, formatDay(day.day)))}
            {days.length > 1 ? row(total, 'Total') : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatDay(key: string): string {
  // Noon keeps the date on the same day in any time zone.
  return new Date(`${key}T12:00:00`).toLocaleDateString('es-CR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
