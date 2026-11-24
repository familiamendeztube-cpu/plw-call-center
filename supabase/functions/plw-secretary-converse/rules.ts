import { createHash } from 'node:crypto';
import { KIKE_TOKEN } from './kikeDraft.ts';

// Trusted origins that may embed the public preview. Requests from any other origin get
// the first entry echoed back (a fixed allowlist value, never an untrusted origin).
const TRUSTED_ORIGINS = [
  'https://familiamendeztube-cp-q9tc.bolt.host',
  'https://familiamendeztube-cp-zfid.bolt.host',
  'https://plw-callcenter.bolt.host',
  'http://localhost:5173',
] as const;

export function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Type': 'application/json',
      Vary: 'Origin',
    },
  });
}

export function audioResponse(mp3: Uint8Array, origin: string): Response {
  return new Response(mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength), {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
      'Cache-Control': 'no-store',
      'Content-Type': 'audio/mpeg',
      Vary: 'Origin',
    },
  });
}

export function corsPreflight(request: Request): Response {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin(request),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
      Vary: 'Origin',
    },
  });
}

export function allowedOrigin(request: Request): string {
  const origin = request.headers.get('Origin') ?? '';
  return (TRUSTED_ORIGINS as readonly string[]).includes(origin) ? origin : TRUSTED_ORIGINS[0];
}

const TOKEN = /^[0-9a-f]{48}$/;

/** A Call Center sample's token (with or without "plw-"), or a Kike Code preview's "kike-<token>" as is. */
export function normalizeToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (KIKE_TOKEN.test(raw)) return raw;
  const token = raw.startsWith('plw-') ? raw.slice(4) : raw;
  return TOKEN.test(token) ? token : null;
}

export type ConverseLanguage = 'es' | 'en' | 'zh' | 'auto';

export interface ConverseRequest {
  token: string;
  audio: Uint8Array | null;
  text: string;
  language: ConverseLanguage;
}

export interface ParsedConverse {
  token: string;
  audio: Uint8Array | null;
  text: string;
  language: ConverseLanguage;
}

// ~30 s of browser Opus at 128 kbps. The old 2 MB cap allowed several minutes of audio
// per request, all billed as speech-to-text.
const MAX_AUDIO_BYTES = 512 * 1024;
const MAX_TEXT_CHARS = 300;

/** Accepts multipart/form-data (token, audio file or text, language) or JSON. */
export async function parseConverseRequest(req: Request): Promise<ConverseRequest | null> {
  const contentType = req.headers.get('Content-Type') ?? '';
  let token: unknown;
  let text: unknown;
  let language: unknown;
  let audio: Uint8Array | null = null;

  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return null;
    }
    token = form.get('token');
    text = form.get('text');
    language = form.get('language');
    const file = form.get('audio');
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_AUDIO_BYTES) return null;
      audio = new Uint8Array(await file.arrayBuffer());
    }
  } else {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return null;
    }
    token = body['token'];
    text = body['text'];
    language = body['language'];
    if (typeof body['audioBase64'] === 'string' && body['audioBase64'] !== '') {
      const raw = body['audioBase64'] as string;
      if (raw.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4) return null;
      audio = Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0));
    }
  }

  const normalized = normalizeToken(token);
  if (!normalized) return null;

  const lang = language === undefined || language === null || language === '' ? 'es' : language;
  if (lang !== 'es' && lang !== 'en' && lang !== 'zh' && lang !== 'auto') return null;

  const cleanText = typeof text === 'string' ? text.trim().slice(0, MAX_TEXT_CHARS) : '';
  if (!audio && !cleanText) return null;

  return { token: normalized, audio, text: cleanText, language: lang };
}

/** Per preview link: an IP key is spoofable through x-forwarded-for. */
export function rateKey(token: string): string {
  return createHash('sha256').update(`converse|${token}`).digest('hex');
}

export function windowBucket(): string {
  return new Date().toISOString().slice(0, 16); // minute precision
}

export function cacheKey(model: string, voice: string, language: string, text: string): string {
  return createHash('sha256').update(`${model}|${voice}|${language}|${text}`).digest('hex');
}
