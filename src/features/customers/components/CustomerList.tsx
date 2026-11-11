import { Search } from 'lucide-react';
import { cx } from '@/components/ui/cx';
import { StatusMessage } from '@/components/ui/StatusMessage';
import type { CustomerEntry } from '@/features/customers/models/customerEntries';
import { matchesCustomerQuery } from '@/features/customers/models/customerEntries';
import {
  SALES_STAGE_LABELS,
  SALES_STAGES,
  type SalesStage,
} from '@/features/leads/models/prospect';

interface TagColors {
  /** The tag at rest, and the stage label on each customer. */
  tag: string;
  /** The tag the list is filtered by. White text on these shades keeps 4.5:1 contrast. */
  active: string;
}

const ALL_COLORS: TagColors = {
  tag: 'bg-neutral-50 text-neutral-700 ring-neutral-200 hover:bg-neutral-100',
  active: 'bg-plw-navy text-white ring-plw-navy',
};

// Hues spread around the wheel so neighbouring stages never look alike; lost is grey, as closed.
const STAGE_COLORS: Record<SalesStage, TagColors> = {
  new: {
    tag: 'bg-sky-400/15 text-sky-200 ring-sky-400/30 hover:bg-sky-400/25',
    active: 'bg-sky-700 text-white ring-sky-700',
  },
  contacted: {
    tag: 'bg-indigo-400/15 text-indigo-200 ring-indigo-400/30 hover:bg-indigo-400/25',
    active: 'bg-indigo-600 text-white ring-indigo-600',
  },
  demo_scheduled: {
    tag: 'bg-fuchsia-400/15 text-fuchsia-200 ring-fuchsia-400/30 hover:bg-fuchsia-400/25',
    active: 'bg-fuchsia-700 text-white ring-fuchsia-700',
  },
  proposal_sent: {
    tag: 'bg-amber-400/15 text-amber-200 ring-amber-400/30 hover:bg-amber-400/25',
    active: 'bg-amber-700 text-white ring-amber-700',
  },
  follow_up: {
    tag: 'bg-rose-400/15 text-rose-200 ring-rose-400/30 hover:bg-rose-400/25',
    active: 'bg-rose-700 text-white ring-rose-700',
  },
  won: {
    tag: 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/30 hover:bg-emerald-400/25',
    active: 'bg-emerald-700 text-white ring-emerald-700',
  },
  lost: {
    tag: 'bg-neutral-100 text-neutral-600 ring-neutral-300 hover:bg-neutral-200',
    active: 'bg-neutral-600 text-white ring-neutral-600',
  },
};

interface StageTagProps {
  label: string;
  count: number;
  active: boolean;
  colors: TagColors;
  onClick: () => void;
}

function StageTag({ label, count, active, colors, onClick }: StageTagProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/60',
        active ? colors.active : colors.tag
      )}
    >
      {/* The space makes screen readers say "Nuevo 3", not "Nuevo3"; flex hides it on screen. */}
      {label} <span className="tabular-nums opacity-80">{count}</span>
    </button>
  );
}

interface CustomerListProps {
  entries: CustomerEntry[];
  selectedId: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  /** Null shows every stage. */
  stage: SalesStage | null;
  onStageChange: (stage: SalesStage | null) => void;
  onSelect: (prospectId: string) => void;
}

export function CustomerList({
  entries,
  selectedId,
  query,
  onQueryChange,
  stage,
  onStageChange,
  onSelect,
}: CustomerListProps) {
  const visible = entries.filter(
    (entry) =>
      (stage === null || entry.prospect.stage === stage) &&
      matchesCustomerQuery(entry.prospect, query)
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-neutral-200 p-4">
        <label className="relative block">
          <span className="sr-only">Buscar clientes</span>
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar por nombre o número"
            className="h-10 w-full rounded-lg border border-neutral-300 bg-white pl-9 pr-3 text-sm text-plw-ink placeholder:text-neutral-400 focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30"
          />
        </label>
        <div role="group" aria-label="Filtrar por etapa" className="mt-3 flex flex-wrap gap-1.5">
          <StageTag
            label="Todos"
            count={entries.length}
            active={stage === null}
            colors={ALL_COLORS}
            onClick={() => onStageChange(null)}
          />
          {SALES_STAGES.map((item) => (
            <StageTag
              key={item}
              label={SALES_STAGE_LABELS[item]}
              count={entries.filter((entry) => entry.prospect.stage === item).length}
              active={stage === item}
              colors={STAGE_COLORS[item]}
              // A second click on the chosen tag shows every customer again.
              onClick={() => onStageChange(stage === item ? null : item)}
            />
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <StatusMessage
          tone="empty"
          title="Aún no tienes clientes asignados."
          description="Cuando te asignen un cliente aparecerá aquí."
        />
      ) : null}
      {entries.length > 0 && visible.length === 0 ? (
        <StatusMessage tone="empty" title="Ningún cliente coincide con la búsqueda o la etapa." />
      ) : null}

      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Clientes asignados">
        {visible.map(({ prospect, conversation }) => {
          const selected = prospect.id === selectedId;
          const unread = conversation?.unread === true;
          return (
            <li key={prospect.id}>
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(prospect.id)}
                className={cx(
                  'relative flex w-full min-w-0 flex-col gap-1 border-b border-neutral-100 px-4 py-3.5 text-left transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-plw-gold/60',
                  selected ? 'bg-plw-ivory' : 'hover:bg-neutral-50'
                )}
              >
                {selected ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-plw-gold"
                  />
                ) : null}
                <span className="flex min-w-0 items-center gap-2">
                  {unread ? (
                    <span
                      aria-label="Mensaje sin leer"
                      className="h-2 w-2 shrink-0 rounded-full bg-plw-gold"
                    />
                  ) : null}
                  <span
                    className={cx(
                      'truncate text-sm text-plw-ink',
                      unread ? 'font-semibold' : 'font-medium'
                    )}
                  >
                    {prospect.businessName}
                  </span>
                </span>
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-xs text-neutral-500">{prospect.contactName}</span>
                  <span
                    className={cx(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                      STAGE_COLORS[prospect.stage].tag
                    )}
                  >
                    {SALES_STAGE_LABELS[prospect.stage]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
