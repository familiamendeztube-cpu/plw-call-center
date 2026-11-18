// after_call (post-call wrap-up) still means the agent's app is open and reachable: a dentist
// calling PLW back must ring them instead of hearing a refusal. Only paused, offline,
// disabled or mid-in_call states gate the queue; Asterisk's own device state handles busy.
export function queueEligibility(accounts, profiles, presence, now = Date.now()) {
  const people = new Map(profiles.map(p => [p.id, p]));
  const states = new Map(presence.map(p => [p.staff_id, p]));
  return accounts.map(a => {
    const person = people.get(a.staff_id);
    const state = states.get(a.staff_id);
    const age = now - Date.parse(state?.last_heartbeat_at ?? '');
    return { username: a.sip_username, available: !!(person?.is_enabled && person.role === 'agent' &&
      state?.availability === 'active' &&
      Number.isFinite(age) && age >= -5000 && age <= 90000) };
  });
}

export function validCall(c) {
  return c && /^[a-zA-Z0-9._-]{1,100}$/.test(c.unique_id) &&
    /^[a-zA-Z0-9._-]{1,100}$/.test(c.linked_id) &&
    (c.sip_username === null || /^agent-[0-9]+$/.test(c.sip_username)) &&
    ['inbound', 'outbound'].includes(c.direction) &&
    typeof c.number === 'string' && /^[+0-9]{0,20}$/.test(c.number) &&
    typeof c.disposition === 'string' && /^[A-Z ]{1,30}$/.test(c.disposition) &&
    Number.isInteger(c.talk_seconds) && c.talk_seconds >= 0 && c.talk_seconds <= 604800 &&
    Number.isFinite(Date.parse(c.started_at)) && Number.isFinite(Date.parse(c.ended_at)) &&
    Date.parse(c.ended_at) >= Date.parse(c.started_at);
}
