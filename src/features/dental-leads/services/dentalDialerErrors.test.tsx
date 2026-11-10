import { describe, expect, it, vi } from 'vitest';
import { dialerReadError } from './dentalDialer';

vi.mock('@/integrations/supabase/client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/integrations/supabase/callStaffFunction', () => ({ callStaffFunction: vi.fn() }));

describe('dialerReadError', () => {
  it('asks for sign-in again when the session expired', () => {
    expect(dialerReadError({ code: 'PGRST301', message: 'JWT expired' }).message).toBe(
      'Su sesión venció. Ingrese de nuevo para continuar.'
    );
    expect(dialerReadError({ status: 401 }).message).toBe(
      'Su sesión venció. Ingrese de nuevo para continuar.'
    );
  });

  it('keeps the install message only for a missing dialer table', () => {
    expect(dialerReadError({ code: '42P01', message: 'relation missing' }).message).toBe(
      'Falta instalar o conectar el control del marcador dental.'
    );
  });

  it('reports other read failures without the install message', () => {
    expect(dialerReadError({ code: '57014', message: 'timeout' }).message).toBe(
      'No se pudo leer el marcador. Reintente en unos segundos.'
    );
  });
});
