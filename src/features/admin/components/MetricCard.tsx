import type { ReactNode } from 'react';
import { Panel } from '@/components/ui/Panel';

interface MetricCardProps {
  label: string;
  value: number | string;
  hint: string;
  icon: ReactNode;
}

export function MetricCard({ label, value, hint, icon }: MetricCardProps) {
  return (
    <Panel as="article" className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-neutral-600">{label}</p>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-plw-ivory text-plw-gold">
          {icon}
        </span>
      </div>
      <div>
        <p className="text-3xl font-semibold text-plw-ink">{value}</p>
        <p className="mt-1 text-xs text-neutral-500">{hint}</p>
      </div>
    </Panel>
  );
}
