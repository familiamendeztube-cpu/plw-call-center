export const APP_TIME_ZONE = 'America/Costa_Rica';

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

export function formatDateTime(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

export function formatLongDate(date: Date): string {
  return DATE_FORMAT.format(date);
}

export function getCostaRicaDayKey(date: Date): string {
  return DAY_KEY_FORMAT.format(date);
}

export function isSameCostaRicaDay(iso: string, reference: Date): boolean {
  return getCostaRicaDayKey(new Date(iso)) === getCostaRicaDayKey(reference);
}

export function costaRicaLocalInputToIso(localValue: string): string {
  return new Date(`${localValue}:00-06:00`).toISOString();
}

export function isoToCostaRicaLocalInput(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
