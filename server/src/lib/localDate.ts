import { appTimezone } from '../config/env';

// Єдине місце, де момент UTC перетворюється на дату університету (data_model.md §1, G9).
// Рядок збирається з частин, а не з format(): вигляд дати для локалі залежить від даних ICU.
const dateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: appTimezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Найбільше відхилення часового поясу від UTC — 14 год (UTC+14, UTC−12).
const MAX_UTC_OFFSET_MS = 14 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Дата `YYYY-MM-DD` — той самий вигляд, що й параметр `date` в API.
export function toLocalDate(instant: Date): string {
  const parts = dateParts.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const wallClockParts = new Intl.DateTimeFormat('en-US', {
  timeZone: appTimezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

// Різниця між годинником університету й UTC у момент `instant` (з урахуванням літнього часу).
function utcOffsetMs(instant: number): number {
  const parts = wallClockParts.formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wallClockAsUtc - (instant - (instant % 1000));
}

// Момент UTC для повної години `hour` дати `YYYY-MM-DD` у поясі університету — зворотне до toLocalDate.
// Офсет уточнюється вдруге в самому результаті, тож дата переходу на літній час рахується правильно.
// Для години, якої в цю дату немає (перехід уперед), результат зсувається на годину пізніше.
export function localDateTimeToUtc(date: string, hour: number): Date {
  const wallClockAsUtc = Date.parse(`${date}T00:00:00.000Z`) + hour * 60 * 60 * 1000;
  const firstGuess = wallClockAsUtc - utcOffsetMs(wallClockAsUtc);
  return new Date(wallClockAsUtc - utcOffsetMs(firstGuess));
}

// Проміжок UTC, що гарантовано містить усю дату `YYYY-MM-DD` у будь-якому поясі.
// Точну належність до дати перевіряє toLocalDate: так не треба вручну рахувати перехід на літній час.
export function utcRangeCovering(date: string): { from: Date; to: Date } {
  const midnightUtc = Date.parse(`${date}T00:00:00.000Z`);
  return {
    from: new Date(midnightUtc - MAX_UTC_OFFSET_MS),
    to: new Date(midnightUtc + DAY_MS + MAX_UTC_OFFSET_MS),
  };
}
