import { useContext } from 'react';
import { PresenceContext } from '@/features/presence/context/presenceContext';

export const DIAL_REQUIRES_ACTIVE = 'Cambie su estado a Activo para hacer llamadas.';

/**
 * Agents place calls only while they are Activo (the owner's rule). Answering is never
 * blocked. Outside an agent workspace there is no presence, so nothing is blocked.
 */
export function useCanDial(): boolean {
  const presence = useContext(PresenceContext);
  return !presence || presence.availability === 'active';
}
