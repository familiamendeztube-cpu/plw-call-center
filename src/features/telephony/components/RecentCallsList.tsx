import { ArrowDownLeft, ArrowUpRight, PhoneMissed } from 'lucide-react';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { formatCallDuration } from '@/features/telephony/models/call';
import { formatTime } from '@/app/dates';

export function RecentCallsList() {
  const { recentCalls } = useTelephony();

  if (recentCalls.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl bg-neutral-50 px-4 py-6 text-center">
        <PhoneMissed size={20} className="text-neutral-400" aria-hidden="true" />
        <p className="text-sm font-medium text-neutral-700">Sin llamadas registradas</p>
        <p className="text-xs text-neutral-500">
          El historial aparecerá cuando la telefonía esté configurada.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-neutral-100">
      {recentCalls.map((call) => {
        const Icon = call.direction === 'outbound' ? ArrowUpRight : ArrowDownLeft;
        return (
          <li key={call.id} className="flex items-center gap-3 py-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-plw-ivory text-plw-navy">
              <Icon size={14} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-plw-ink">
                {call.remoteNumber}
              </span>
              <span className="block text-xs text-neutral-500">{formatTime(call.endedAt)}</span>
            </span>
            <span className="font-mono text-xs text-neutral-500">
              {formatCallDuration(call.durationSeconds)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
