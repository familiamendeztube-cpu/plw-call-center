import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProductionAuthService } from './productionAuthService';

const auth = {
  getSession: vi.fn(),
  signOut: vi.fn(),
};
const profileMaybeSingle = vi.fn();
const client = {
  auth,
  from: vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle: profileMaybeSingle }) }),
  })),
};

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => client,
  supabaseAnonKeyValue: 'anon',
  supabaseFunctionsUrl: 'https://example.test/functions/v1',
}));

describe('production auth stale session cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.signOut.mockResolvedValue({ error: null });
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'auth-user-1' }, access_token: 'token' } },
      error: null,
    });
  });

  it('clears a stale profile locally without requesting global revocation', async () => {
    profileMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await createProductionAuthService().restoreSession();

    expect(result.session).toBeNull();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(auth.signOut.mock.calls[0]).toEqual([{ scope: 'local' }]);
  });

  it('clears a disabled profile locally without requesting global revocation', async () => {
    profileMaybeSingle.mockResolvedValue({
      data: { id: 'admin-1', role: 'admin', display_name: 'Admin', is_enabled: false },
      error: null,
    });

    await createProductionAuthService().restoreSession();

    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
