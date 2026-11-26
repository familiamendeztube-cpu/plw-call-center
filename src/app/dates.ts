// The app's clock is US Pacific, the Los Angeles office (owner, 2026-11-26). Formats stay Spanish.
export const APP_TIME_ZONE = 'America/Los_Angeles';
export const APP_TIME_ZONE_LABEL = 'hora del Pacífico (Los Ángeles)';

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('es-CR', {
  timeZone: APP_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const TIME_FORMAT = new Intl.DateTimeFormat('es-CR', {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});

const DATE_FORMAT = new Intl.DateTimeFormat('es-CR', {
  timeZone: APP_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const DAY_KEY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const LOCAL_INPUT_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatDateTime(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

export function formatLongDate(date: Date): string {
  return DATE_FORMAT.format(date);
}

/** "2026-12-01": the day in the app's clock, to group and compare by day. */
export function getAppDayKey(date: Date): string {
  return DAY_KEY_FORMAT.format(date);
}

export function isSameAppDay(iso: string, reference: Date): boolean {
  return getAppDayKey(new Date(iso)) === getAppDayKey(reference);
}

/** The app's wall clock at `iso`, as a datetime-local value ("2026-12-01T10:30"). */
export function isoToAppLocalInput(iso: string): string {
  const parts = LOCAL_INPUT_FORMAT.formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

const wallClockMs = (localValue: string) => {
  const [day, clock] = localValue.split('T');
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = clock.split(':').map(Number);
  return Date.UTC(year, month - 1, date, hour, minute);
};

/** How far the app's clock is from UTC at that instant (negative in the Americas). */
const zoneOffsetMs = (utcMs: number) =>
  wallClockMs(isoToAppLocalInput(new Date(utcMs).toISOString())) - Math.floor(utcMs / 60_000) * 60_000;

/**
 * A datetime-local value typed in the app's clock, as an ISO instant. The browser would read it
 * in its own zone (Costa Rica for the agents), so the offset is worked out for that date,
 * daylight saving included; the second pass settles times right after a change.
 */
export function appLocalInputToIso(localValue: string): string {
  const wall = wallClockMs(localValue);
  const first = wall - zoneOffsetMs(wall);
  return new Date(wall - zoneOffsetMs(first)).toISOString();
}

/** Costa Rica time (no daylight saving), only for Costa Rica hotel demos booked on its hours. */
export function costaRicaLocalInputToIso(localValue: string): string {
  return new Date(`${localValue}:00-06:00`).toISOString();
}
