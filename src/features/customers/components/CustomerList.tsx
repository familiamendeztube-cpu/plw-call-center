import { Search } from 'lucide-react';
import { cx } from '@/components/ui/cx';
import { StatusMessage } from '@/components/ui/StatusMessage';
import type { CustomerEntry } from '@/features/customers/models/customerEntries';
import { matchesCustomerQuery } from '@/features/customers/models/customerEntries';

interface CustomerListProps {
  entries: CustomerEntry[];
  selectedId: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (prospectId: string) => void;
}

export function CustomerList({
  entries,
  selectedId,
  query,
  onQueryChange,
  onSelect,
}: CustomerListProps) {
  const visible = entries.filter((entry) => matchesCustomerQuery(entry.prospect, query));

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
            placeholder="Buscar cliente"
            className="h-10 w-full rounded-lg border border-neutral-300 bg-white pl-9 pr-3 text-sm text-plw-ink placeholder:text-neutral-400 focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30"
          />
        </label>
        <p className="mt-2 text-xs text-neutral-500">{entries.length} clientes asignados</p>
      </div>

      {entries.length === 0 ? (
        <StatusMessage
          tone="empty"
          title="Aún no tienes clientes asignados."
          description="Cuando te asignen un cliente aparecerá aquí."
        />
      ) : null}
      {entries.length > 0 && visible.length === 0 ? (
        <StatusMessage tone="empty" title="Ningún cliente coincide con la búsqueda." />
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
                <span className="truncate text-xs text-neutral-500">{prospect.contactName}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
