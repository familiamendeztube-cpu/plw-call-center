import { describe, expect, it } from 'vitest';
import { dentalCallIdFromHeader, type CallSnapshot } from '@/features/telephony/models/call';
import {
  dentalContext,
  dentalMatch,
  isIncomingRinging,
  showCompactContext,
  type IncomingDentalCallRow,
} from './incomingDentalCall';

const callId = '6f1c3c2e-8b1d-4c57-9a55-2d1f0a7e9b10';
const ringing: CallSnapshot = {
  id: 'sip-1',
  state: 'ringing',
  direction: 'inbound',
  remoteNumber: '22223333',
  startedAt: null,
  muted: false,
  dentalCallId: callId,
};
const row: IncomingDentalCallRow = {
  id: callId,
  lead_id: 'lead-1',
  staff_id: 'agent-2',
  phone: '22223333',
  state: 'started',
  transfer_status: 'requested',
  summary: 'Interesada en recibir una llamada del asesor.',
};

describe('dental call header', () => {
  it('accepts only a well-formed UUID and rejects missing or malformed values', () => {
    expect(dentalCallIdFromHeader(` ${callId} `)).toBe(callId);
    expect(dentalCallIdFromHeader(null)).toBeNull();
    expect(dentalCallIdFromHeader(undefined)).toBeNull();
    expect(dentalCallIdFromHeader('')).toBeNull();
    expect(dentalCallIdFromHeader('latest')).toBeNull();
    expect(dentalCallIdFromHeader(`${callId}; drop`)).toBeNull();
  });
});

describe('incoming call state', () => {
  it('treats only inbound ringing calls as the big alert', () => {
    expect(isIncomingRinging(ringing)).toBe(true);
    expect(isIncomingRinging({ ...ringing, direction: 'outbound' })).toBe(false);
    expect(isIncomingRinging({ ...ringing, state: 'active' })).toBe(false);
    expect(isIncomingRinging(null)).toBe(false);
  });

  it('shows compact context only while the human call is active or on hold', () => {
    expect(showCompactContext({ ...ringing, state: 'active' })).toBe(true);
    expect(showCompactContext({ ...ringing, state: 'on_hold' })).toBe(true);
    expect(showCompactContext(ringing)).toBe(false);
    expect(showCompactContext(null)).toBe(false);
  });

  it("matches by header, else by the caller's Costa Rican number, only while the call is live", () => {
    expect(dentalMatch(ringing)).toEqual({ id: callId, phone: null });
    expect(dentalMatch({ ...ringing, state: 'active' })).toEqual({ id: callId, phone: null });
    expect(dentalMatch({ ...ringing, state: 'ended' })).toBeNull();
    // Asterisk's transfer drops the header; the dentist's number still arrives.
    const byNumber = { ...ringing, dentalCallId: null };
    expect(dentalMatch(byNumber)).toEqual({ id: null, phone: '22223333' });
    expect(dentalMatch({ ...byNumber, remoteNumber: '50622223333' })).toEqual({ id: null, phone: '22223333' });
    expect(dentalMatch({ ...byNumber, remoteNumber: 'agent-3' })).toBeNull();
    expect(dentalMatch({ ...byNumber, direction: 'outbound' })).toBeNull();
  });
});

describe('dental context', () => {
  const lead = { id: 'lead-1', business_name: 'Clínica Demo', province: 'San José', canton: null, address: null };

  it('has no context without a match, an agent, or a lookup', () => {
    expect(
      dentalContext({ ...ringing, dentalCallId: null, remoteNumber: '100' }, 'agent-2', { status: 'loading' })
    ).toEqual({ kind: 'none' });
    expect(dentalContext(ringing, null, { status: 'loading' })).toEqual({ kind: 'none' });
    expect(dentalContext(ringing, 'agent-2', null)).toEqual({ kind: 'none' });
  });

  it('reports loading and unavailable without exposing another lead', () => {
    expect(dentalContext(ringing, 'agent-2', { status: 'loading' })).toEqual({ kind: 'loading' });
    expect(dentalContext(ringing, 'agent-2', { status: 'unknown' })).toEqual({ kind: 'unavailable' });
    expect(
      dentalContext(ringing, 'agent-3', { status: 'ready', call: row, lead })
    ).toEqual({ kind: 'unavailable' });
    expect(
      dentalContext(ringing, 'agent-2', { status: 'ready', call: { ...row, id: 'other' }, lead })
    ).toEqual({ kind: 'unavailable' });
  });

  it('keeps context for a call Ana completed at transfer while the human call still rings or is active', () => {
    const completed = { ...row, state: 'completed', transfer_status: 'completed' };
    expect(dentalContext({ ...ringing, state: 'active' }, 'agent-2', { status: 'ready', call: completed, lead })).toEqual({
      kind: 'ready',
      call: completed,
      lead,
    });
  });

  it("stays quiet on a number match until the agent's own dental call is found", () => {
    const byNumber = { ...ringing, dentalCallId: null };
    expect(dentalContext(byNumber, 'agent-2', { status: 'loading' })).toEqual({ kind: 'none' });
    expect(dentalContext(byNumber, 'agent-2', { status: 'unknown' })).toEqual({ kind: 'none' });
    expect(dentalContext(byNumber, 'agent-2', { status: 'none' })).toEqual({ kind: 'none' });
    expect(dentalContext(byNumber, 'agent-3', { status: 'ready', call: row, lead })).toEqual({ kind: 'none' });
    expect(dentalContext(byNumber, 'agent-2', { status: 'ready', call: row, lead })).toEqual({
      kind: 'ready',
      call: row,
      lead,
    });
  });

  it('shows the owned call with its lead', () => {
    expect(dentalContext(ringing, 'agent-2', { status: 'ready', call: row, lead })).toEqual({
      kind: 'ready',
      call: row,
      lead,
    });
  });
});
