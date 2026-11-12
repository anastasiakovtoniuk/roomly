import { appTimezone } from '../config/env';

// Єдине місце, де момент UTC перетворюється на дату університету (data_model.md §1, G9).
// en-CA форматує дату як YYYY-MM-DD — той самий вигляд, що й параметр `date` в API.
const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: appTimezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Найбільше відхилення часового поясу від UTC — 14 год (UTC+14, UTC−12).
const MAX_UTC_OFFSET_MS = 14 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function toLocalDate(instant: Date): string {
  return dateFormat.format(instant);
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
