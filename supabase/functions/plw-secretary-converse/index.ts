// Public conversational turn for the secretary demo (typed question or microphone).
// A short caller question is transcribed (Scribe v2), classified into a fixed opaque
// answer id, and answered with the same approved line the visitor sees — the raw
// transcript is never retained, never spoken, and never sent to text-to-speech.
// No agent data, no telephony, no retention of audio in PLW.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  allowedOrigin,
  audioResponse,
  cacheKey,
  corsPreflight,
  json,
  parseConverseRequest,
  rateKey,
  windowBucket,
} from './rules.ts';
import {
  buildConverse,
  classifyTranscript,
  type AnswerContext,
  type ConverseId,
} from './grounding.ts';

// Same verified voice profile as plw-tourism-voice (see scripts/lib/verifyElevenModel.mjs).
const MODEL = Deno.env.get('ELEVENLABS_TTS_MODEL') ?? 'eleven_multilingual_v2';
const VOICE_ID = Deno.env.get('ELEVENLABS_PREVIEW_VOICE_ID') ?? '21m00Tcm4TlvDq8ikWAM';
const RATE_LIMIT = 20; // requests per minute per token+IP
const STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
const STT_MODEL = 'scribe_v1';

interface DraftRow {
  business_name: string | null;
  locale: string | null;
  category: string | null;
  services: unknown;
  highlight: string | null;
  description: string | null;
  faqs: unknown;
  secretary_name: string | null;
  secretary_type: string | null;
}

function contextFromDraft(row: DraftRow): AnswerContext {
  return {
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
    secretary:
      typeof row.secretary_name === 'string' && row.secretary_name.trim() !== ''
        ? {
            businessName: row.secretary_name,
            businessType: typeof row.secretary_type === 'string' ? row.secretary_type : '',
          }
        : undefined,
  };
}

// Scribe v2 transcription. The audio bytes are streamed to ElevenLabs and discarded;
// logging is disabled and neither the audio nor the transcript is stored in PLW.
async function transcribe(
  audio: Uint8Array,
  apiKey: string,
  language: 'es' | 'en' | 'zh' | 'auto'
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const form = new FormData();
  form.append('model_id', STT_MODEL);
  form.append('enable_logging', 'false');
  form.append(
    'file',
    new Blob([audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength)], {
      type: 'application/octet-stream',
    }),
    'turn.webm'
  );
  if (language !== 'auto') form.append('language_code', language === 'zh' ? 'zh' : language);

  let response: Response;
  try {
    response = await fetch(STT_URL, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    });
  } catch (cause) {
    console.error('plw-secretary-converse stt fetch', cause);
    return { ok: false, status: 502, error: 'El reconocimiento de voz no está disponible.' };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      status: 503,
      error: 'El reconocimiento de voz no está disponible. Puede escribir su pregunta.',
    };
  }
  if (!response.ok) {
    console.error('plw-secretary-converse stt status', response.status);
    return { ok: false, status: 502, error: 'El reconocimiento de voz no está disponible.' };
  }
  const payload = await response.json();
  const text = typeof payload?.text === 'string' ? payload.text.trim().slice(0, 300) : '';
  if (!text) return { ok: false, status: 400, error: 'No se entendió la grabación. Intente de nuevo.' };
  return { ok: true, text };
}

async function synthesize(text: string, apiKey: string): Promise<Uint8Array | null> {
  let response: Response;
  try {
    response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({ text, model_id: MODEL, output_format: 'mp3_44100_128' }),
    });
  } catch (cause) {
    console.error('plw-secretary-converse tts fetch', cause);
    return null;
  }
  if (!response.ok) {
    console.error('plw-secretary-converse tts status', response.status);
    return null;
  }
  return new Uint8Array(await response.arrayBuffer());
}

Deno.serve(async (req) => {
  const origin = allowedOrigin(req);
  if (req.method === 'OPTIONS') return corsPreflight(req);
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405, origin);

  const parsed = await parseConverseRequest(req);
  if (!parsed) return json({ error: 'Solicitud no válida.' }, 400, origin);

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Conservative rate limit before any external work.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const key = rateKey(parsed.token, ip);
  const bucket = windowBucket();
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

  // Public unlisted preview: resolve the active draft by token only. No staff data.
  const { data: row, error: lookupError } = await db
    .from('prospect_site_drafts')
    .select(
      'business_name, locale, category, services, highlight, description, faqs, secretary_name, secretary_type'
    )
    .eq('preview_token', parsed.token)
    .maybeSingle();
  if (lookupError) return json({ error: 'Secretaria no disponible.' }, 502, origin);
  if (!row) return json({ error: 'Vista previa no encontrada.' }, 404, origin);

  // Resolve the question: microphone audio via Scribe, or the typed text directly.
  let transcript = parsed.text;
  if (!transcript && parsed.audio) {
    if (parsed.audio.byteLength === 0) {
      return json({ error: 'La grabación llegó vacía. Intente de nuevo.' }, 400, origin);
    }
    const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
    if (!apiKey) {
      return json(
        { error: 'El reconocimiento de voz no está disponible. Puede escribir su pregunta.', unavailable: 'stt' },
        503,
        origin
      );
    }
    const stt = await transcribe(parsed.audio, apiKey, parsed.language);
    if (!stt.ok) return json({ error: stt.error, unavailable: stt.status === 503 ? 'stt' : undefined }, stt.status, origin);
    transcript = stt.text;
  }

  // Classify into a fixed opaque id; only the approved reply line is spoken or shown.
  const answerId: ConverseId = classifyTranscript(transcript);
  const ctx = contextFromDraft(row);
  const replyLang = parsed.language === 'zh' || parsed.language === 'auto' ? 'es' : parsed.language;
  let text = buildConverse(answerId, replyLang, ctx);
  if (!text) text = buildConverse('conv-fallback', replyLang, ctx);
  if (!text) return json({ error: 'Respuesta no disponible.' }, 404, origin);

  const ckey = cacheKey(MODEL, VOICE_ID, replyLang, text);
  const { data: cached } = await db
    .from('plw_voice_cache')
    .select('audio_base64')
    .eq('cache_key', ckey)
    .maybeSingle();

  const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
  let mp3: Uint8Array | null = null;
  if (cached?.audio_base64) {
    mp3 = Uint8Array.from(atob(cached.audio_base64), (ch) => ch.charCodeAt(0));
  } else if (apiKey) {
    mp3 = await synthesize(text, apiKey);
    if (mp3) {
      // Chunked base64: spreading the whole buffer into String.fromCharCode overflows
      // the stack for longer audio, which surfaced as a bare 500.
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < mp3.length; i += CHUNK) {
        binary += String.fromCharCode(...mp3.subarray(i, i + CHUNK));
      }
      const base64 = btoa(binary);
      await db
        .from('plw_voice_cache')
        .upsert({ cache_key: ckey, audio_base64: base64 }, { onConflict: 'cache_key' });
    }
  }

  if (!mp3) {
    // Text fallback: the visitor still sees the approved reply even without audio.
    return json({ answerId, text, audio: false }, 200, origin);
  }
  return audioResponse(mp3, origin);
});
