// Дата запиту й час у UI мають один пояс із сервером; право бронювати перевіряє сервер.
declare const __APP_TIMEZONE__: string;

export const APP_TIMEZONE = typeof __APP_TIMEZONE__ === 'string' ? __APP_TIMEZONE__ : 'Europe/Kyiv';

export function universityDate(value: Date | string = new Date(), timeZone = APP_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatDate(value: Date | string, timeZone = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatTime(value: Date | string, timeZone = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
