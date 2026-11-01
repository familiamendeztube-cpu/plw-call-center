import { createContext, useContext } from 'react';
import type { AppServices } from '@/app/appServices';

export const ServicesContext = createContext<AppServices | null>(null);

export function useAppServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) {
    throw new Error('useAppServices debe usarse dentro de ServicesContext.');
  }
  return services;
}
