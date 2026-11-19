import { createClient } from 'npm:@supabase/supabase-js@2';
import { normalizeToken, toSavedSite } from './rules.js';

// Public, read-only preview of a prospect's Kike Sites draft, keyed by its opaque token.
// The Kike Sites project (a separate Supabase backend) fetches this to render the sample
// page: GET ?token=<token> returns the SavedSite shape, or 404. The token is the only key:
// no session, no writes, and the response carries public marketing fields only.

// Kike Sites production origin plus this project's own deployments for verified use.
const ALLOWED_ORIGINS = [
  'https://familiamendeztube-cp-q9tc.bolt.host',
  'https://plw-callcenter.bolt.host',
  'http://localhost:5173',
];

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  // A preview must not be cached by browsers or listed by search engines.
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Origin',
});

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders(origin) });
  if (req.method !== 'GET') return json({ error: 'Método no permitido.' }, 405, origin);

  const url = new URL(req.url);
  const token = normalizeToken(url.searchParams.get('token'));
  if (!token) return json({ error: 'Solicitud no válida.' }, 400, origin);

  // Service role: the draft table grants no anonymous read; the token is the only key.
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await db
    .from('prospect_site_drafts')
    .select(
      'id, site_slug, business_name, locale, category, services, highlight, booking_phone, description, facts, faqs'
    )
    .eq('preview_token', token)
    .maybeSingle();
  if (error) {
    console.error('plw-tourism-preview lookup', error.message);
    return json({ error: 'Vista previa no disponible.' }, 502, origin);
  }
  // Same answer for "does not exist" and "wrong token".
  if (!data) return json({ error: 'Vista previa no encontrada.' }, 404, origin);

  return json(toSavedSite(data, data.id), 200, origin);
});
