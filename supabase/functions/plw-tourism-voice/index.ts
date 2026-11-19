// Server-only ElevenLabs speech for the public tourism preview. Accepts a preview token
// plus a grounded answer id; resolves the draft, builds the line from confirmed public
// fields only, synthesizes with the configured ElevenLabs voice, caches, and rate-limits.
// There is no open text-to-speech proxy: arbitrary caller text is never synthesized.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  audioResponse,
  cacheKey,
  corsPreflight,
  json,
  allowedOrigin,
  parseVoiceRequest,
  rateKey,
  windowBucket,
} from './rules.ts';
import { buildAnswer, buildMandarinLine, type AnswerContext } from './grounding.ts';

// Verified against the account's synchronous /v1/models endpoint plus a real synthesis
// (see scripts/lib/verifyElevenModel.mjs); falls back to the previous model if unset.
const MODEL = Deno.env.get('ELEVENLABS_TTS_MODEL') ?? 'eleven_multilingual_v2';
// Approved environment voice; falls back to a known voice id if not set.
const VOICE_ID = Deno.env.get('ELEVENLABS_PREVIEW_VOICE_ID') ?? '21m00Tcm4TlvDq8ikWAM';
const MAX_TEXT = 400;
const RATE_LIMIT = 10; // requests per minute per token+IP

Deno.serve(async (req) => {
  // CORS is derived per request from the trusted allowlist; never a global env value,
  // which can go stale (e.g. a localhost origin leaking into production).
  const origin = allowedOrigin(req);
  if (req.method === 'OPTIONS') return corsPreflight(req);
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405, origin);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Solicitud no válida.' }, 400, origin);
  }
  const parsed = parseVoiceRequest(body);
  if (!parsed) return json({ error: 'Solicitud no válida.' }, 400, origin);

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Rate limit before any work.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const bucket = windowBucket();
  const key = rateKey(parsed.token, ip);
  const { data: hit } = await db
    .from('plw_voice_rate')
    .select('hit_count')
    .match({ rate_key: key, window_bucket: bucket })
    .maybeSingle();
  const currentCount = hit?.hit_count ?? 0;
  if (currentCount >= RATE_LIMIT) {
    return json({ error: 'Demasiadas solicitudes. Intente en un momento.' }, 429, origin);
  }
  await db
    .from('plw_voice_rate')
    .upsert(
      { rate_key: key, window_bucket: bucket, hit_count: currentCount + 1 },
      { onConflict: 'rate_key,window_bucket' }
    );

  // Resolve the active preview draft by token.
  const { data: row, error: lookupError } = await db
    .from('prospect_site_drafts')
    .select('business_name, locale, category, services, highlight, description, faqs, secretary_name, secretary_type')
    .eq('preview_token', parsed.token)
    .maybeSingle();
  if (lookupError) return json({ error: 'Voz no disponible.' }, 502, origin);
  if (!row) return json({ error: 'Vista previa no encontrada.' }, 404, origin);

  const ctx: AnswerContext = {
    businessName: row.business_name ?? '',
    locale: row.locale ?? '',
    category: row.category ?? '',
    services: Array.isArray(row.services) ? row.services.filter((s) => typeof s === 'string') : [],
    highlight: row.highlight ?? '',
    description: row.description ?? '',
    faqs: Array.isArray(row.faqs)
      ? (row.faqs as { question?: unknown; answer?: unknown }[])
          .filter(
            (faq): faq is { question: string; answer: string } =>
              typeof faq?.question === 'string' && typeof faq?.answer === 'string'
          )
          .map((faq) => ({ question: faq.question, answer: faq.answer }))
      : [],
    // Optional secretary profile; defaults to the draft's own name and category upstream.
    secretary:
      typeof row.secretary_name === 'string' && row.secretary_name.trim() !== ''
        ? {
            businessName: row.secretary_name,
            businessType: typeof row.secretary_type === 'string' ? row.secretary_type : '',
          }
        : undefined,
  };
  // Mandarin is only spoken for the secretary-language demo line; same voice profile.
  const text =
    parsed.language === 'zh'
      ? buildMandarinLine(parsed.answerId, ctx)
      : buildAnswer(parsed.answerId, parsed.language, ctx);
  if (!text || text.length > MAX_TEXT) {
    return json({ error: 'Contenido no disponible para leer en voz alta.' }, 404, origin);
  }

  const ckey = cacheKey(MODEL, VOICE_ID, parsed.language, text);

  // Cached audio first.
  const { data: cached } = await db
    .from('plw_voice_cache')
    .select('audio_base64')
    .eq('cache_key', ckey)
    .maybeSingle();
  if (cached?.audio_base64) {
    const bytes = Uint8Array.from(atob(cached.audio_base64), (ch) => ch.charCodeAt(0));
    return audioResponse(bytes, origin);
  }

  const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
  if (!apiKey) return json({ error: 'Voz no configurada.' }, 503, origin);

  let response: Response;
  try {
    response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        output_format: 'mp3_44100_128',
      }),
    });
  } catch (cause) {
    console.error('plw-tourism-voice tts fetch', cause);
    return json({ error: 'Voz no disponible.' }, 502, origin);
  }
  if (!response.ok) {
    console.error('plw-tourism-voice tts status', response.status);
    return json({ error: 'Voz no disponible.' }, 502, origin);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  // Chunked base64: spreading the whole buffer into String.fromCharCode overflows the
  // stack for longer audio (larger secretary lines), which surfaced as a bare 500.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
  }
  const base64 = btoa(binary);

  // Store in the cache; a failure to cache does not fail the response.
  await db
    .from('plw_voice_cache')
    .upsert({ cache_key: ckey, audio_base64: base64 }, { onConflict: 'cache_key' });

  return audioResponse(buffer, origin);
});
