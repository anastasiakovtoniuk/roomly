import { describe, expect, it } from 'vitest';
import { formatTime, universityDate } from '../../client/src/lib/dateTime';

// Допоміжна логіка відображення US-2.4; повний AC додатково перевіряється через UI.
describe('Дата та час університету на клієнті', () => {
  it('US-2.4-AC-01: дата для запиту відповідає університету, навіть коли день UTC інший', () => {
    const instant = '2026-11-13T22:30:00.000Z';
    expect(universityDate(instant, 'Europe/Kyiv')).toBe('2026-11-14');
    expect(universityDate(instant, 'UTC')).toBe('2026-11-13');
  });

  it('US-2.4-AC-01: ранковий слот UTC показує місцевий час університету', () => {
    expect(formatTime('2026-11-14T07:00:00.000Z', 'Europe/Kyiv')).toBe('09:00');
  });

  it('US-2.4-AC-01: перехід на літній час не зсуває календарну дату слота', () => {
    expect(formatTime('2026-03-29T00:30:00.000Z', 'Europe/Kyiv')).toBe('02:30');
    expect(formatTime('2026-03-29T01:30:00.000Z', 'Europe/Kyiv')).toBe('04:30');
    expect(universityDate('2026-03-29T01:30:00.000Z', 'Europe/Kyiv')).toBe('2026-03-29');
  });

  it('US-2.4-AC-01: повторена година восени відображається за часовим поясом, а не фіксованим зсувом', () => {
    expect(formatTime('2026-10-25T00:30:00.000Z', 'Europe/Kyiv')).toBe('03:30');
    expect(formatTime('2026-10-25T01:30:00.000Z', 'Europe/Kyiv')).toBe('03:30');
  });
});
