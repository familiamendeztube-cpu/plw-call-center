// Session authorization for us-sms, copied from the proven telephony handler (no cross-function
// imports: edge functions bundle in isolation). A request counts only with a valid, unrevoked
// session; the body is read after this check.
function sessionIdFromJwt(jwt) {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}

export async function authorizeStaff({ admin, jwt }) {
  const sessionId = sessionIdFromJwt(jwt);
  const { data: userData, error } = await admin.auth.getUser(jwt);
  if (error || !userData?.user || !sessionId) return null;

  const { data, error: resolveError } = await admin.rpc('resolve_staff_session', {
    p_session_id: sessionId,
    p_auth_user_id: userData.user.id,
  });
  if (resolveError) throw resolveError;

  const row = Array.isArray(data) ? data[0] : data;
  return row ? { staffId: row.staff_id, role: row.staff_role } : null;
}
