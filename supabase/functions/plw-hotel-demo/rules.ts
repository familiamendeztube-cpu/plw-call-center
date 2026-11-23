import { createHash } from 'node:crypto';

// Same trusted origins as plw-secretary-converse: requests from any other origin get the
// first entry echoed back (a fixed allowlist value, never an untrusted origin).
const TRUSTED_ORIGINS = [
  'https://familiamendeztube-cp-q9tc.bolt.host',
  'https://familiamendeztube-cp-zfid.bolt.host',
  'https://plw-callcenter.bolt.host',
  'http://localhost:5173',
] as const;

const BASE_HEADERS = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Origin',
} as const;

export function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin, 'Content-Type': 'application/json' },
  });
}

export function corsPreflight(request: Request): Response {
  return new Response(null, {
    status: 200,
    headers: { ...BASE_HEADERS, 'Access-Control-Allow-Origin': allowedOrigin(request) },
  });
}

export function allowedOrigin(request: Request): string {
  const origin = request.headers.get('Origin') ?? '';
  return (TRUSTED_ORIGINS as readonly string[]).includes(origin) ? origin : TRUSTED_ORIGINS[0];
}

const TOKEN = /^[0-9a-f]{48}$/;

export function normalizeToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const token = raw.startsWith('plw-') ? raw.slice(4) : raw;
  return TOKEN.test(token) ? token : null;
}

/** Per link: an IP key is spoofable through x-forwarded-for. */
export function rateKey(scope: string, token: string): string {
  return createHash('sha256').update(`${scope}|${token}`).digest('hex');
}

export function windowBucket(): string {
  return new Date().toISOString().slice(0, 16); // minute precision
}

const HOUR = 60 * 60 * 1000;

/** Times the hotel can pick: the next 5 weekdays that still have time left, every 30 minutes
 *  from 08:00 to 15:30 Costa Rica (UTC-6, no DST), at least an hour out (the database rule),
 *  minus the ones Alejandro already has. */
export function candidateSlots(taken: Set<number>, now: Date): string[] {
  const out: string[] = [];
  const earliest = now.getTime() + HOUR;
  let days = 0;
  for (let day = 0; days < 5 && day < 14; day += 1) {
    const opening = new Date(now.getTime() + day * 24 * HOUR);
    opening.setUTCHours(14, 0, 0, 0); // 08:00 CR
    const weekday = opening.getUTCDay(); // 0 Sun ... 6 Sat
    if (weekday === 0 || weekday === 6) continue;
    const times: number[] = [];
    for (let minutes = 0; minutes < 8 * 60; minutes += 30) {
      const slot = opening.getTime() + minutes * 60 * 1000;
      if (slot > earliest) times.push(slot);
    }
    if (times.length === 0) continue; // today, already past 15:30
    days += 1;
    for (const slot of times) {
      if (!taken.has(slot)) out.push(new Date(slot).toISOString().replace('.000Z', 'Z'));
    }
  }
  return out;
}
