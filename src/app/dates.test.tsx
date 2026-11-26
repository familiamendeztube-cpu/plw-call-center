import { expect, test } from 'vitest';
import { appLocalInputToIso, getAppDayKey, isoToAppLocalInput } from '@/app/dates';

test('a time typed in the app is Los Angeles time, winter and summer, whatever the browser zone', () => {
  expect(appLocalInputToIso('2026-12-01T10:30')).toBe('2026-12-01T18:30:00.000Z'); // PST, UTC-8
  expect(appLocalInputToIso('2026-07-01T10:30')).toBe('2026-07-01T17:30:00.000Z'); // PDT, UTC-7
  // Right after the March change and right before the November one.
  expect(appLocalInputToIso('2026-03-08T03:30')).toBe('2026-03-08T10:30:00.000Z');
  expect(appLocalInputToIso('2026-11-01T00:30')).toBe('2026-11-01T07:30:00.000Z');
  for (const value of ['2026-12-01T10:30', '2026-07-01T23:59', '2026-03-08T03:30'])
    expect(isoToAppLocalInput(appLocalInputToIso(value))).toBe(value);
});

test('the day turns at midnight in Los Angeles, not in Costa Rica', () => {
  // 07:30 UTC is 01:30 in Costa Rica but still the previous evening in Los Angeles.
  expect(getAppDayKey(new Date('2026-12-02T07:30:00Z'))).toBe('2026-12-01');
});
