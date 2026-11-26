import { expect, test } from 'vitest';
import { callerOrigin, mergeRecentCalls, originLabel, phoneKey, toUsNumber } from '@/features/telephony/models/call';

test('agents can dial US numbers however they are typed, and nothing else', () => {
  for (const typed of ['(305) 555-1234', '305.555.1234', '+1 305 555 1234', '13055551234', '3055551234'])
    expect(toUsNumber(typed)).toBe('+13055551234');
  // Costa Rica, premium, N11 area codes, bad exchanges, extensions and short codes are refused.
  for (const typed of ['8888-1234', '+506 8888 1234', '9005551234', '9765551234', '4115551234', '3051551234', '911', 'agent-3', ''])
    expect(toUsNumber(typed)).toBeNull();
});

test('every caller is labelled Costa Rica or EE. UU. by the shape of the number', () => {
  expect(callerOrigin('88881234')).toBe('cr');
  expect(callerOrigin('+506 2222-3344')).toBe('cr');
  expect(callerOrigin('+13055551234')).toBe('us');
  expect(callerOrigin('3055551234')).toBe('us');
  expect(originLabel('50688881234')).toBe('Costa Rica');
  expect(originLabel('+1 (213) 555-0100')).toBe('EE. UU.');
  expect(originLabel('agent-2')).toBe('');
  expect(originLabel('100')).toBe('');
});

test('one number matches itself in any format, and two US numbers sharing 8 digits stay apart', () => {
  expect(phoneKey('+506 8888-1234')).toBe(phoneKey('88881234'));
  expect(phoneKey('+1 (305) 555-1234')).toBe(phoneKey('3055551234'));
  expect(phoneKey('3055551234')).not.toBe(phoneKey('4055551234'));
  // A live call and the server's record of it show once, but the other area code stays.
  const at = '2026-11-26T18:00:00Z';
  const merged = mergeRecentCalls(
    [
      { id: 'live-1', remoteNumber: '+13055551234', direction: 'outbound', endedAt: at, durationSeconds: 30 },
      { id: 'live-2', remoteNumber: '+14055551234', direction: 'outbound', endedAt: at, durationSeconds: 30 },
    ],
    [{ id: 'saved-1', remoteNumber: '13055551234', direction: 'outbound', endedAt: at, durationSeconds: 30 }]
  );
  expect(merged.map((call) => call.id).sort()).toEqual(['live-2', 'saved-1']);
});

// The server copy is checked in scripts/chatwootWebhook.test.mjs.
test('WhatsApp takes a US number without +1 and still takes Costa Rica callers', async () => {
  const { whatsAppNumber } = await import('@/features/whatsapp/hooks/useWhatsApp');
  expect(whatsAppNumber('(305) 555-1234')).toBe('+13055551234');
  expect(whatsAppNumber('+1 305 555 1234')).toBe('+13055551234');
  expect(whatsAppNumber('8888 1234')).toBe('+50688881234');
  expect(whatsAppNumber('+44 20 7946 0958')).toBe('+442079460958');
  expect(whatsAppNumber('+1 105 555 1234')).toBeNull();
});

test('numbers show with the US area code in parentheses, and Costa Rica as 4-4', async () => {
  const { formatPhone } = await import('@/features/telephony/models/call');
  expect(formatPhone('+12029003800')).toBe('(202) 900-3800');
  expect(formatPhone('2029003800')).toBe('(202) 900-3800');
  expect(formatPhone('+50688881234')).toBe('8888-1234');
  expect(formatPhone('agent-2')).toBe('agent-2');
});
