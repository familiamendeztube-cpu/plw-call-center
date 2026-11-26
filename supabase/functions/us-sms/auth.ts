import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

function sessionIdFromJwt(jwt: string): string | null {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}

function evaluateAdminSession({
  sessionId,
  resolved,
}: {
  sessionId: string | null;
  resolved: unknown;
}) {
  const row = (Array.isArray(resolved) ? resolved[0] : resolved) as
    Record<string, unknown> | null | undefined;
  if (!sessionId || !row)
    return { ok: false as const, status: 401, error: 'Sesión revocada o no válida.' };
  if (row.staff_role !== 'admin')
    return { ok: false as const, status: 403, error: 'No autorizado.' };
  return { ok: true as const, staffId: String(row.staff_id) };
}

export async function authorizeAdmin({ admin, jwt }: { admin: SupabaseClient; jwt: string }) {
  const sessionId = sessionIdFromJwt(jwt);
  const { data: userData, error } = await admin.auth.getUser(jwt);
  if (error || !userData?.user) {
    return { ok: false as const, status: 401, body: { error: 'Sesión no válida.' }, actorId: '' };
  }

  const { data: resolved, error: resolveError } = sessionId
    ? await admin.rpc('resolve_staff_session', {
        p_session_id: sessionId,
        p_auth_user_id: userData.user.id,
      })
    : { data: null, error: null };
  if (resolveError) throw resolveError;

  const decision = evaluateAdminSession({ sessionId, resolved });
  if (!decision.ok) {
    return {
      ok: false as const,
      status: decision.status,
      body: { error: decision.error },
      actorId: '',
    };
  }
  return { ok: true as const, status: 200, body: {}, actorId: decision.staffId as string };
}
