import { expect, test } from 'vitest';
import { ringSamples } from '@/integrations/telephony/sipTelephonyConnector';

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
