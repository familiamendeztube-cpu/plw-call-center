import { describe, expect, it } from 'vitest';
import { dentalCallIdFromHeader, type CallSnapshot } from '@/features/telephony/models/call';
import { incomingDentalView, type IncomingDentalCallRow } from './incomingDentalCall';

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

describe('incoming dental call view', () => {
  it('stays hidden for ordinary, outbound, admin and uncorrelated calls', () => {
    const ready = { status: 'ready', call: row, lead: null } as const;
    expect(incomingDentalView({ ...ringing, dentalCallId: null }, 'agent-2', ready).kind).toBe(
      'hidden'
    );
    expect(incomingDentalView({ ...ringing, direction: 'outbound' }, 'agent-2', ready).kind).toBe(
      'hidden'
    );
    expect(incomingDentalView({ ...ringing, state: 'active' }, 'agent-2', ready).kind).toBe(
      'hidden'
    );
    expect(incomingDentalView(ringing, null, ready).kind).toBe('hidden');
    expect(incomingDentalView(null, 'agent-2', ready).kind).toBe('hidden');
  });

  it('shows loading while the lookup runs and an honest unknown state when it fails', () => {
    expect(incomingDentalView(ringing, 'agent-2', { status: 'loading' }).kind).toBe('loading');
    expect(incomingDentalView(ringing, 'agent-2', { status: 'unknown' }).kind).toBe('unknown');
  });

  it('refuses a call that belongs to another agent (recipient mismatch)', () => {
    const view = incomingDentalView(ringing, 'agent-3', {
      status: 'ready',
      call: row,
      lead: null,
    });
    expect(view.kind).toBe('unknown');
  });

  it('refuses a correlated row whose id does not match the header', () => {
    const view = incomingDentalView(ringing, 'agent-2', {
      status: 'ready',
      call: { ...row, id: 'other' },
      lead: null,
    });
    expect(view.kind).toBe('unknown');
  });

  it('does not show a call the dialer no longer treats as open', () => {
    const view = incomingDentalView(ringing, 'agent-2', {
      status: 'ready',
      call: { ...row, state: 'completed' },
      lead: null,
    });
    expect(view.kind).toBe('unknown');
  });

  it('shows the owned, open call with its lead', () => {
    const lead = { id: 'lead-1', business_name: 'Clínica Demo', province: 'San José', canton: null, address: null };
    const view = incomingDentalView(ringing, 'agent-2', { status: 'ready', call: row, lead });
    expect(view).toEqual({ kind: 'ready', callId, call: row, lead });
  });
});
