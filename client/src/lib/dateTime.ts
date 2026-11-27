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

// Час «ГГ:ХХ» у поясі університету — пара до universityDate (зворотне перетворення UTC → форма).
export function universityTime(value: Date | string, timeZone = APP_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${part('hour')}:${part('minute')}`;
}

// Зсув пояса в мілісекундах у заданий момент: місцевий час мінус UTC.
function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const local = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return local - (instant - (((instant % 1000) + 1000) % 1000));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Дата й час із форми адміністратора (у поясі університету) → ISO 8601 UTC із `Z` для API (TA-4).
// null — значення некоректне або такого місцевого часу немає (весняний перехід на літній час).
// Повторена осіння година неоднозначна: обирається раніший момент. Зсув береться за добу до й після
// дати, а кандидат приймається лише тоді, коли зворотне перетворення дає ту саму дату й час.
export function universityDateTimeToUtc(date: string, time: string, timeZone = APP_TIMEZONE): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const naive = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  if (Number.isNaN(naive)) return null;

  const candidates = [
    ...new Set([naive - zoneOffset(naive - DAY_MS, timeZone), naive - zoneOffset(naive + DAY_MS, timeZone)]),
  ];
  const match = candidates
    .sort((a, b) => a - b)
    .find(
      (instant) =>
        universityDate(new Date(instant), timeZone) === date &&
        universityTime(new Date(instant), timeZone) === time,
    );
  return match === undefined ? null : new Date(match).toISOString();
}
