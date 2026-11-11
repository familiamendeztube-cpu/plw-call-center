import { expect, test } from 'vitest';
import { ringbackSamples, ringSamples } from '@/integrations/telephony/sipTelephonyConnector';

test('an outgoing call plays a quiet ringback: one second of tone, four of silence', () => {
  const rate = 8000;
  const cycle = ringbackSamples(rate);
  const loudest = (from: number, to: number) =>
    Math.max(...cycle.slice(from * rate, to * rate).map(Math.abs));

  expect(cycle.length).toBe(5 * rate);
  expect(loudest(0, 1)).toBeGreaterThan(0.15);
  expect(loudest(1, 5)).toBe(0);
});

test('an incoming call rings twice, then pauses, loud enough to hear away from the desk', () => {
  const rate = 8000;
  const cycle = ringSamples(rate);
  const loudest = (from: number, to: number) =>
    Math.max(...cycle.slice(from * rate, to * rate).map(Math.abs));

  expect(cycle.length).toBe(3 * rate);
  expect(loudest(0, 0.4)).toBeGreaterThan(0.45);
  expect(loudest(0.4, 0.6)).toBe(0);
  expect(loudest(0.6, 1)).toBeGreaterThan(0.45);
  expect(loudest(1, 3)).toBe(0);
});
