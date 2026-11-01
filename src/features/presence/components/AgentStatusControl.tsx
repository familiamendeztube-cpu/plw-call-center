import { AlertTriangle } from 'lucide-react';
import { usePresence } from '@/features/presence/context/presenceContext';
import { resolveDisplayStatus } from '@/features/presence/models/availability';
import { PresenceControl } from '@/features/presence/components/PresenceControl';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { toOperationalStatus } from '@/features/telephony/models/call';

export function AgentStatusControl() {
  const { availability, error } = usePresence();
  const { call } = useTelephony();
  const displayStatus = resolveDisplayStatus(availability, toOperationalStatus(call));

  return (
    <div className="flex flex-col items-end gap-1">
      <PresenceControl displayStatus={displayStatus} />
      {error ? (
        <p role="alert" className="flex items-center gap-1 text-xs text-warning-100">
          <AlertTriangle size={12} aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
