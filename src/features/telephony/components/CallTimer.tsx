import { useEffect, useState } from 'react';
import { formatCallDuration } from '@/features/telephony/models/call';

interface CallTimerProps {
  startedAt: string | null;
  running: boolean;
}

export function CallTimer({ startedAt, running }: CallTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) {
      return undefined;
    }
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [running]);

  const elapsed =
    running && startedAt
      ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
      : 0;

  return (
    <span className="font-mono text-sm tabular-nums text-neutral-600" aria-label="Duración">
      {formatCallDuration(elapsed)}
    </span>
  );
}
