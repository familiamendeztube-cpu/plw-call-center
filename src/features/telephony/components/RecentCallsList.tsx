import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Phone, PhoneMissed } from 'lucide-react';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { formatCallDuration, toCostaRicaNumber } from '@/features/telephony/models/call';
import { CUSTOMER_PARAM } from '@/features/customers/models/customerLinks';
import { useOptionalAgentProspects } from '@/features/leads/context/agentProspectsContext';
import { formatTime } from '@/app/dates';

export function RecentCallsList() {
  const { recentCalls, changeDialNumber } = useTelephony();
  const prospects = useOptionalAgentProspects();

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
        const customer = prospects?.findByPhone(call.remoteNumber) ?? null;
        const dialable = toCostaRicaNumber(call.remoteNumber);
        return (
          <li key={call.id} className="flex items-center gap-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-plw-ivory text-plw-navy">
              <Icon size={14} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              {customer ? (
                <Link
                  to={`/clientes?${CUSTOMER_PARAM}=${customer.id}`}
                  className="block truncate text-sm font-medium text-plw-navy hover:underline"
                >
                  {customer.businessName}
                </Link>
              ) : (
                <span className="block truncate text-sm font-medium text-plw-ink">
                  {call.remoteNumber}
                </span>
              )}
              <span className="block text-xs text-neutral-500">
                {customer ? `${call.remoteNumber} · ` : ''}
                {formatTime(call.endedAt)} · {formatCallDuration(call.durationSeconds)}
              </span>
            </span>
            {dialable ? (
              <button
                type="button"
                onClick={() => changeDialNumber(dialable)}
                aria-label={`Marcar de nuevo ${customer?.businessName ?? call.remoteNumber}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-plw-navy transition-[background-color,transform] duration-150 ease-out hover:bg-plw-ivory active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/60"
              >
                <Phone size={14} aria-hidden="true" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
