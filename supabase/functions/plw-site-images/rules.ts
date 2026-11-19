import { createHash } from 'node:crypto';

// Magic-byte sniffing beats client content types: never trust the declared type.
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedType = (typeof ALLOWED_TYPES)[number];

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_CANDIDATES_PER_PROSPECT = 24;
export const MAX_IMAGES_PER_DRAFT = 4;

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

export function corsPreflight(): Response {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
    },
  });
}

// Allowed origins mirror plw-tourism-preview.
export function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = [
    'https://familiamendeztube-cp-q9tc.bolt.host',
    'https://plw-callcenter.bolt.host',
    'http://localhost:5173',
  ];
  return allowed.includes(origin) ? origin : allowed[0];
}

/** Detects the real image type from magic bytes; rejects anything else (no type spoofing). */
export function detectImageType(bytes: Uint8Array): AllowedType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Stable public object name for an approved image: hash of the candidate bytes. */
export function approvedObjectName(bytes: Uint8Array): string {
  return `approved/${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.webp`;
}

export const CANDIDATE_BUCKET = 'plw-site-candidates';
export const APPROVED_BUCKET = 'plw-site-images';
export const APPROVED_PUBLIC_BASE = '/storage/v1/object/public/plw-site-images/';
