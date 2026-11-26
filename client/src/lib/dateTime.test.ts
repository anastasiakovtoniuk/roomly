import { describe, expect, it } from 'vitest';
import { formatTime, universityDate, universityDateTimeToUtc, universityTime } from './dateTime';

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

// Форма слота адміністратора (US-A.2): дата й час у поясі університету → UTC ISO для API і назад.
describe('Час слота з форми адміністратора', () => {
  it('US-A.2-AC-01: зимовий час Києва (UTC+2) переводиться в UTC із Z', () => {
    expect(universityDateTimeToUtc('2026-11-30', '10:00', 'Europe/Kyiv')).toBe('2026-11-30T08:00:00.000Z');
  });

  it('US-A.2-AC-01: літній час Києва (UTC+3) і зворотне перетворення дають ту саму дату й час', () => {
    const iso = universityDateTimeToUtc('2026-07-15', '09:30', 'Europe/Kyiv');
    expect(iso).toBe('2026-07-15T06:30:00.000Z');
    expect(universityDate(iso!, 'Europe/Kyiv')).toBe('2026-07-15');
    expect(universityTime(iso!, 'Europe/Kyiv')).toBe('09:30');
  });

  it('US-A.2-AC-01: північ і пізній вечір не зсувають дату університету', () => {
    expect(universityDateTimeToUtc('2026-11-30', '00:00', 'Europe/Kyiv')).toBe('2026-11-29T22:00:00.000Z');
    expect(universityDateTimeToUtc('2026-11-30', '23:30', 'Europe/Kyiv')).toBe('2026-11-30T21:30:00.000Z');
    expect(universityTime('2026-11-29T22:00:00.000Z', 'Europe/Kyiv')).toBe('00:00');
  });

  it('US-A.2-AC-01: часу, пропущеного навесні, немає: форма показує помилку, а не зсуває слот', () => {
    expect(universityDateTimeToUtc('2026-03-29', '03:30', 'Europe/Kyiv')).toBeNull();
    expect(universityDateTimeToUtc('2026-03-29', '04:00', 'Europe/Kyiv')).toBe('2026-03-29T01:00:00.000Z');
  });

  it('US-A.2-AC-01: повторена осіння година дає раніший момент', () => {
    expect(universityDateTimeToUtc('2026-10-25', '03:30', 'Europe/Kyiv')).toBe('2026-10-25T00:30:00.000Z');
  });

  it('US-A.2-AC-01: неіснуюча дата й неповний час відхиляються', () => {
    expect(universityDateTimeToUtc('2026-02-30', '10:00', 'Europe/Kyiv')).toBeNull();
    expect(universityDateTimeToUtc('2026-11-30', '', 'Europe/Kyiv')).toBeNull();
    expect(universityDateTimeToUtc('', '10:00', 'Europe/Kyiv')).toBeNull();
  });
});
