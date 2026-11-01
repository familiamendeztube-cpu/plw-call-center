import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AgentId } from '@/features/auth/models/agent';
import type { Availability } from '@/features/presence/models/availability';
import type { PresenceService } from '@/features/presence/services/presenceService';
import {
  PresenceContext,
  type PresenceContextValue,
} from '@/features/presence/context/presenceContext';

const HEARTBEAT_INTERVAL_MS = 30_000;

interface PresenceProviderProps {
  agentId: AgentId;
  service: PresenceService;
  children: ReactNode;
}

export function PresenceProvider({ agentId, service, children }: PresenceProviderProps) {
  const [availability, setLocalAvailability] = useState<Availability>('active');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    service
      .listPresence()
      .then((entries) => {
        const own = entries.find((entry) => entry.agentId === agentId);
        if (active && own) {
          setLocalAvailability(own.availability);
        }
      })
      .catch(() => {
        if (active) {
          setError('No se pudo cargar tu disponibilidad.');
        }
      });
    return () => {
      active = false;
    };
  }, [agentId, service]);

  useEffect(() => {
    const beat = () => {
      service.sendHeartbeat().then(
        () => setError(null),
        () => setError('No se pudo confirmar tu conexión. Reintentando...')
      );
    };
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    const handleVisible = () => {
      if (document.visibilityState === 'visible') beat();
    };
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('online', beat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('online', beat);
    };
  }, [service]);

  const setAvailability = useCallback(
    async (next: Availability) => {
      const previous = availability;
      setLocalAvailability(next);
      setError(null);
      try {
        await service.setAvailability(agentId, next);
      } catch {
        setLocalAvailability(previous);
        setError('No se pudo actualizar tu disponibilidad. Intenta de nuevo.');
      }
    },
    [agentId, availability, service]
  );

  const value = useMemo<PresenceContextValue>(
    () => ({ availability, error, setAvailability }),
    [availability, error, setAvailability]
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}
