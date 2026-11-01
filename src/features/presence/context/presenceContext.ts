import { createContext, useContext } from 'react';
import type { Availability } from '@/features/presence/models/availability';

export interface PresenceContextValue {
  availability: Availability;
  error: string | null;
  setAvailability: (availability: Availability) => Promise<void>;
}

export const PresenceContext = createContext<PresenceContextValue | null>(null);

export function usePresence(): PresenceContextValue {
  const value = useContext(PresenceContext);
  if (!value) {
    throw new Error('usePresence debe usarse dentro de PresenceProvider.');
  }
  return value;
}
