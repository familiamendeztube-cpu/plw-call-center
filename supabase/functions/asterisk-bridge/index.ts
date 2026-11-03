import { createClient } from 'npm:@supabase/supabase-js@2';
import { queueEligibility, validCall } from './rules.js';

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  } });
}

async function matchesSecret(received: string, expected: string) {
  if (expected.length < 64) return false;
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(received), digest(expected)]);
  return a.reduce((diff, byte, i) => diff | (byte ^ b[i]), 0) === 0;
}

Deno.serve(async req => {
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!await matchesSecret(req.headers.get('X-PLW-Bridge-Token') ?? '', Deno.env.get('ASTERISK_BRIDGE_TOKEN') ?? '')) {
    return reply({ error: 'Unauthorized' }, 401);
  }
  try {
    const raw = await req.text();
    if (raw.length > 200000) return reply({ error: 'Too large' }, 413);
    const body = JSON.parse(raw);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const [accounts, profiles, presence] = await Promise.all([
      db.from('agent_sip_accounts').select('staff_id,sip_username'),
      db.from('staff_profiles').select('id,role,is_enabled'),
      db.from('staff_presence').select('staff_id,availability,operational,last_heartbeat_at'),
    ]);
    for (const result of [accounts, profiles, presence]) if (result.error) throw result.error;
    if (body.action === 'eligibility') {
      return reply({ agents: queueEligibility(accounts.data!, profiles.data!, presence.data!) });
    }
    if (body.action === 'calls') {
      if (!Array.isArray(body.calls) || body.calls.length > 100 || !body.calls.every(validCall)) {
        return reply({ error: 'Invalid call batch' }, 400);
      }
      const mapping = new Map(accounts.data!.map(a => [a.sip_username, a.staff_id]));
      const rows = body.calls.map((c: Record<string, unknown>) => ({
        unique_id: c.unique_id, linked_id: c.linked_id,
        sip_username: c.sip_username, staff_id: mapping.get(String(c.sip_username)) ?? null,
        direction: c.direction, number: c.number, disposition: c.disposition,
        talk_seconds: c.talk_seconds, started_at: c.started_at, ended_at: c.ended_at,
      }));
      if (rows.length) {
        const { error } = await db.from('asterisk_calls').upsert(rows, { onConflict: 'unique_id', ignoreDuplicates: true });
        if (error) throw error;
      }
      return reply({ accepted: rows.length });
    }
    return reply({ error: 'Invalid action' }, 400);
  } catch {
    // Never log headers, bodies, secrets or phone numbers.
    return reply({ error: 'Bridge request failed' }, 500);
  }
});
