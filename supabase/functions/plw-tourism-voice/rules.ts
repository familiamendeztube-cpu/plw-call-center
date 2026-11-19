import { createHash } from 'node:crypto';
import { ANSWER_IDS, buildAnswer, isAnswerId, type AnswerContext } from './grounding.ts';

// Trusted origins that may embed the public preview. Requests from any other origin get
// the first entry echoed back (still a fixed allowlist value, never an untrusted origin).
const TRUSTED_ORIGINS = [
  'https://familiamendeztube-cp-q9tc.bolt.host',
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

// Mirrors plw-tourism-preview: reflect a trusted per-request Origin, otherwise the primary origin.
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
  return (TRUSTED_ORIGINS as readonly string[]).includes(origin)
    ? origin
    : TRUSTED_ORIGINS[0];
}

const TOKEN = /^[0-9a-f]{48}$/;

export function normalizeToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const token = raw.startsWith('plw-') ? raw.slice(4) : raw;
  return TOKEN.test(token) ? token : null;
}

export interface VoiceRequest {
  token: string;
  answerId: string;
  language: 'es' | 'en';
}

export function parseVoiceRequest(body: unknown): VoiceRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const token = normalizeToken((body as Record<string, unknown>)['token']);
  const answerId = (body as Record<string, unknown>)['answerId'];
  const language = (body as Record<string, unknown>)['language'];
  // zh (Mandarin) is only valid for the secretary-language demo line.
  if (language === 'zh' && answerId !== 'secretary-language') return null;
  if (language !== 'es' && language !== 'en' && language !== 'zh') return null;
  if (!token || !isAnswerId(answerId)) return null;
  return { token, answerId, language: language };
}

export function rateKey(token: string, ip: string): string {
  return createHash('sha256').update(`${token}|${ip}`).digest('hex');
}

export function windowBucket(): string {
  return new Date().toISOString().slice(0, 16); // minute precision
}

export function cacheKey(model: string, voice: string, language: string, text: string): string {
  return createHash('sha256').update(`${model}|${voice}|${language}|${text}`).digest('hex');
}

export { ANSWER_IDS, buildAnswer, isAnswerId };
export type { AnswerContext };
