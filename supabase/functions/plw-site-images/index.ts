// Authenticated image pipeline for the site-draft "Imágenes del negocio" panel.
//
// Actions (POST JSON):
// - upload:    base64 image bytes -> validated by magic bytes (jpeg/png/webp, <=5MB),
//              stored in the PRIVATE candidates bucket under {prospectId}/, registered
//              in plw_site_image_candidates with kind 'business', authorized=false.
//              Returns a short-lived signed URL for the private thumbnail.
// - generate:  creates a normalized 1024x1024 PNG illustration in public/images/{prospectId}/
//              using OPENAI_API_KEY (GPT Image). Marked kind 'generated'. If the key is
//              absent the endpoint reports 503 { available: false } — no fake results.
// - status:    reports whether generation is configured (by presence of the key only).
// - approve:   {candidateId, alt, kind} -> the agent's explicit approval. The file is
//              copied into the PUBLIC approved bucket under a content-hash name, the
//              public URL is returned, and the candidate row is marked authorized.
//              Only approved/ files ever appear in approved_images on the draft.
//
// Ownership: every action re-validates the caller's session via resolve_staff_session
// and public.can_access_prospect — the browser never talks to storage directly.
// No arbitrary URL fetching: uploads come only from request bodies.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  allowedOrigin,
  APPROVED_BUCKET,
  APPROVED_PUBLIC_BASE,
  approvedObjectName,
  CANDIDATE_BUCKET,
  corsPreflight,
  detectImageType,
  isUuid,
  json,
  MAX_CANDIDATES_PER_PROSPECT,
  MAX_UPLOAD_BYTES,
} from './rules.ts';

const IMAGE_MODEL = 'gpt-image-1';
const MAX_ALT = 200;

interface Session {
  db: ReturnType<typeof createClient>;
  staffId: string;
  staffRole: string;
}

async function authorize(request: Request): Promise<Session | Response> {
  const auth = request.headers.get('Authorization') ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) return json({ error: 'Sesión no válida.' }, 401, allowedOrigin(request));

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data: userData, error } = await db.auth.getUser(jwt);
  if (error || !userData?.user) return json({ error: 'Sesión no válida.' }, 401, allowedOrigin(request));

  let sessionId: string | null = null;
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.session_id === 'string') sessionId = payload.session_id;
  } catch {
    sessionId = null;
  }
  const { data: resolved, error: resolveError } = await db.rpc('resolve_staff_session', {
    p_session_id: sessionId,
    p_auth_user_id: userData.user.id,
  });
  if (resolveError) throw resolveError;
  const row = (Array.isArray(resolved) ? resolved[0] : resolved) as Record<string, unknown> | null;
  if (!row || typeof row.staff_id !== 'string') {
    return json({ error: 'Sesión revocada o no válida.' }, 401, allowedOrigin(request));
  }
  return { db, staffId: row.staff_id, staffRole: typeof row.staff_role === 'string' ? row.staff_role : '' };
}

// Explicit access check for the service-role context: this function's database calls carry
// no JWT claims, so can_access_prospect() (auth.uid()-based) cannot see the caller here.
// Same rule as the browser policies: admin reaches any prospect; an agent only their own.
async function canAccessProspect(
  session: Session,
  prospectId: string
): Promise<boolean> {
  if (session.staffRole === 'admin') return true;
  const { data, error } = await session.db
    .from('prospects')
    .select('id')
    .eq('id', prospectId)
    .eq('owner_id', session.staffId)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function thumbnailUrl(db: Session['db'], path: string): Promise<string | null> {
  const { data, error } = await db.storage.from(CANDIDATE_BUCKET).createSignedUrl(path, 600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function handleUpload(
  request: Request,
  session: Session,
  prospectId: string,
  imageBase64: string
) {
  const origin = allowedOrigin(request);
  const { db } = session;
  if (!(await canAccessProspect(session, prospectId))) {
    return json({ error: 'No autorizado.' }, 403, origin);
  }
  const bytes = Uint8Array.from(atob(imageBase64), (ch) => ch.charCodeAt(0));
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
    return json({ error: 'La imagen debe pesar menos de 5 MB.' }, 413, origin);
  }
  const type = detectImageType(bytes);
  if (!type) {
    return json({ error: 'Solo se aceptan imágenes JPEG, PNG o WebP.' }, 415, origin);
  }
  const { count, error: countError } = await db
    .from('plw_site_image_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('prospect_id', prospectId);
  if (countError) throw countError;
  if ((count ?? 0) >= MAX_CANDIDATES_PER_PROSPECT) {
    return json({ error: 'Ya hay demasiadas imágenes en esta lista.' }, 429, origin);
  }

  const path = `${prospectId}/${crypto.randomUUID()}`;
  const { error: uploadError } = await db.storage
    .from(CANDIDATE_BUCKET)
    .upload(path, bytes, { contentType: type, upsert: false });
  if (uploadError) {
    console.error('plw-site-images upload', uploadError.message);
    return json({ error: 'No se pudo guardar la imagen.' }, 502, origin);
  }
  const { data: inserted, error: insertError } = await db
    .from('plw_site_image_candidates')
    .insert({ prospect_id: prospectId, storage_path: path, kind: 'business', authorized: false, alt: '' })
    .select('id, kind, authorized, alt, storage_path')
    .single();
  if (insertError || !inserted) {
    console.error('plw-site-images register', insertError?.message);
    return json({ error: 'No se pudo registrar la imagen.' }, 502, origin);
  }
  const signedUrl = await thumbnailUrl(db, path);
  return json(
    {
      candidate: {
        id: inserted.id,
        kind: inserted.kind,
        authorized: inserted.authorized,
        alt: inserted.alt,
        thumbnailUrl: signedUrl,
      },
    },
    201,
    origin
  );
}

async function handleStatus(request: Request) {
  const origin = allowedOrigin(request);
  // Presence only: never expose the key value.
  const available = Boolean(Deno.env.get('OPENAI_API_KEY'));
  return json({ generationAvailable: available }, 200, origin);
}

async function handleGenerate(request: Request, session: Session, prospectId: string, prompt: string) {
  const origin = allowedOrigin(request);
  const { db } = session;
  if (!(await canAccessProspect(session, prospectId))) {
    return json({ error: 'No autorizado.' }, 403, origin);
  }
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    return json({ error: 'La generación de imágenes no está configurada.', available: false }, 503, origin);
  }
  const cleanPrompt = prompt.trim().slice(0, 500);
  if (!cleanPrompt) return json({ error: 'Falta la descripción de la imagen.' }, 400, origin);

  const { count, error: countError } = await db
    .from('plw_site_image_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('prospect_id', prospectId)
    .eq('kind', 'generated');
  if (countError) throw countError;
  if ((count ?? 0) >= MAX_CANDIDATES_PER_PROSPECT) {
    return json({ error: 'Ya hay demasiadas imágenes en esta lista.' }, 429, origin);
  }

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: cleanPrompt,
        n: 1,
        size: '1024x1024',
      }),
    });
  } catch (cause) {
    console.error('plw-site-images generate fetch', cause);
    return json({ error: 'Generación no disponible.' }, 502, origin);
  }
  if (!response.ok) {
    console.error('plw-site-images generate status', response.status);
    return json({ error: 'Generación no disponible.' }, 502, origin);
  }
  const payload = await response.json();
  const b64 = payload?.data?.[0]?.b64_json;
  if (typeof b64 !== 'string' || b64 === '') {
    return json({ error: 'Generación no disponible.' }, 502, origin);
  }
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

  const path = `${prospectId}/${crypto.randomUUID()}`;
  const { error: uploadError } = await db.storage
    .from(CANDIDATE_BUCKET)
    .upload(path, bytes, { contentType: 'image/png', upsert: false });
  if (uploadError) {
    console.error('plw-site-images generate upload', uploadError.message);
    return json({ error: 'No se pudo guardar la imagen generada.' }, 502, origin);
  }
  const { data: inserted, error: insertError } = await db
    .from('plw_site_image_candidates')
    .insert({ prospect_id: prospectId, storage_path: path, kind: 'generated', authorized: false, alt: '' })
    .select('id, kind, authorized, alt, storage_path')
    .single();
  if (insertError || !inserted) {
    console.error('plw-site-images generate register', insertError?.message);
    return json({ error: 'No se pudo registrar la imagen generada.' }, 502, origin);
  }
  const signedUrl = await thumbnailUrl(db, path);
  return json(
    {
      candidate: {
        id: inserted.id,
        kind: inserted.kind,
        authorized: inserted.authorized,
        alt: inserted.alt,
        thumbnailUrl: signedUrl,
      },
    },
    201,
    origin
  );
}

async function handleApprove(
  request: Request,
  session: Session,
  prospectId: string,
  candidateId: string,
  alt: string,
  kind: 'business' | 'generated'
) {
  const origin = allowedOrigin(request);
  const { db } = session;
  if (!(await canAccessProspect(session, prospectId))) {
    return json({ error: 'No autorizado.' }, 403, origin);
  }
  const cleanAlt = alt.trim().slice(0, MAX_ALT);
  if (!cleanAlt) return json({ error: 'Escriba una descripción de la imagen.' }, 400, origin);

  const { data: candidate, error: candidateError } = await db
    .from('plw_site_image_candidates')
    .select('id, storage_path, kind, authorized')
    .eq('id', candidateId)
    .eq('prospect_id', prospectId)
    .maybeSingle();
  if (candidateError) throw candidateError;
  if (!candidate) return json({ error: 'Imagen no encontrada.' }, 404, origin);

  const { data: file, error: downloadError } = await db.storage
    .from(CANDIDATE_BUCKET)
    .download(candidate.storage_path);
  if (downloadError || !file) {
    console.error('plw-site-images approve download', downloadError?.message);
    return json({ error: 'No se pudo leer la imagen.' }, 502, origin);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) return json({ error: 'La imagen no es válida.' }, 415, origin);

  const objectName = approvedObjectName(bytes);
  const { error: copyError } = await db.storage
    .from(APPROVED_BUCKET)
    .upload(objectName, bytes, { contentType: type, upsert: true });
  if (copyError && !copyError.message.includes('exists')) {
    console.error('plw-site-images approve upload', copyError.message);
    return json({ error: 'No se pudo publicar la imagen.' }, 502, origin);
  }

  // Full approved/ path: the draft-save validation (set_prospect_site_approved_images)
  // only accepts URLs containing .../plw-site-images/approved/<name>. Stripping the
  // folder here produced a URL the RPC rejected with 'Las imágenes no son válidas.'
  const publicUrl = `${Deno.env.get('SUPABASE_URL')!}${APPROVED_PUBLIC_BASE}${objectName}`;
  const { error: updateError } = await db
    .from('plw_site_image_candidates')
    .update({ authorized: true, alt: cleanAlt, kind })
    .eq('id', candidateId)
    .eq('prospect_id', prospectId);
  if (updateError) throw updateError;

  return json({ url: publicUrl, alt: cleanAlt, kind }, 200, origin);
}

Deno.serve(async (req) => {
  const origin = allowedOrigin(req);
  if (req.method === 'OPTIONS') return corsPreflight(req);
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405, origin);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Solicitud no válida.' }, 400, origin);
  }

  const session = await authorize(req);
  if (session instanceof Response) return session;

  const action = body['action'];
  const prospectId = body['prospectId'];
  if (!isUuid(prospectId)) return json({ error: 'Solicitud no válida.' }, 400, origin);

  try {
    if (action === 'status') return await handleStatus(req);
    if (action === 'upload' && typeof body['imageBase64'] === 'string') {
      return await handleUpload(req, session, prospectId, body['imageBase64']);
    }
    if (action === 'generate' && typeof body['prompt'] === 'string') {
      return await handleGenerate(req, session, prospectId, body['prompt']);
    }
    if (
      action === 'approve' &&
      isUuid(body['candidateId']) &&
      typeof body['alt'] === 'string' &&
      (body['kind'] === 'business' || body['kind'] === 'generated')
    ) {
      return await handleApprove(
        req,
        session,
        prospectId,
        body['candidateId'],
        body['alt'],
        body['kind'] as 'business' | 'generated'
      );
    }
    return json({ error: 'Solicitud no válida.' }, 400, origin);
  } catch (cause) {
    console.error('plw-site-images', cause);
    return json({ error: 'No se pudo completar la acción.' }, 500, origin);
  }
});
