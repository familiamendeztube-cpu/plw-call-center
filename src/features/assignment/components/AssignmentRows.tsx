import type { AssignmentRow } from '@/features/assignment/models/assignmentRows';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { StatusMessage } from '@/components/ui/StatusMessage';

interface AssignmentRowsProps {
  rows: AssignmentRow[];
  emptyTitle: string;
  actionLabel?: string;
  onAction?: (prospectId: string) => void;
}

export function AssignmentRows({ rows, emptyTitle, actionLabel, onAction }: AssignmentRowsProps) {
  if (rows.length === 0) {
    return (
      <Panel>
        <StatusMessage tone="empty" title={emptyTitle} />
      </Panel>
    );
  }

  return (
    <Panel as="section">
      <ul className="divide-y divide-neutral-200">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-3 p-4 transition-colors duration-150 hover:bg-neutral-50 sm:flex-row sm:items-center sm:justify-between sm:p-5"
          >
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold text-plw-ink">{row.title}</h3>
              <p className="mt-1 text-sm text-neutral-600">{row.detail}</p>
              <p className="mt-1 text-xs text-neutral-500">{row.meta}</p>
              {row.note ? (
                <p className="mt-2 rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-700">
                  Motivo: {row.note}
                </p>
              ) : null}
            </div>
            {actionLabel && onAction && row.prospectId !== null ? (
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  if (row.prospectId !== null) onAction?.(row.prospectId);
                }}
              >
                {actionLabel}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
