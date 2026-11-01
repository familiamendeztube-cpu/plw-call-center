export function sessionIdFromJwt(jwt) {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}

function firstRow(resolved) {
  if (Array.isArray(resolved)) return resolved[0] ?? null;
  return resolved ?? null;
}

export function evaluateAdminSession({ sessionId, resolved }) {
  const row = firstRow(resolved);
  if (!sessionId || !row) return { ok: false, status: 401, error: 'Sesión revocada o no válida.' };
  if (row.staff_role !== 'admin') return { ok: false, status: 403, error: 'No autorizado.' };
  return { ok: true, staffId: row.staff_id };
}
