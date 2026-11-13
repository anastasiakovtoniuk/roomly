import { BOOKING_STATUSES } from '@roomly/shared';
import { describe, expect, it } from 'vitest';
import {
  bookingStatusLabel,
  bookingStatusTone,
  canCancelBooking,
  parseBookingScope,
} from '../../client/src/lib/bookingView';

// Допоміжна логіка відображення #13; повний AC додатково перевіряється через UI.
describe('Відображення власних бронювань на клієнті', () => {
  it('US-X.3-AC-01: кожен документований статус має український підпис', () => {
    expect(bookingStatusLabel('active')).toBe('Активне');
    expect(bookingStatusLabel('confirmed')).toBe('Підтверджене');
    expect(bookingStatusLabel('cancelled_by_student')).toBe('Скасовано студентом');
    expect(bookingStatusLabel('auto_cancelled')).toBe('Автоскасовано');
    for (const status of BOOKING_STATUSES) {
      expect(bookingStatusLabel(status)).not.toBe('Статус невідомий');
      expect(bookingStatusTone(status)).not.toBe('unknown');
    }
  });

  it('US-X.3-AC-01: невідомий статус показується нейтрально, зокрема службові ключі об’єкта', () => {
    for (const status of ['pending', '', 'toString', '__proto__']) {
      expect(bookingStatusLabel(status), status).toBe('Статус невідомий');
      expect(bookingStatusTone(status), status).toBe('unknown');
    }
  });

  it('US-4.3-AC-01: кнопка скасування доступна лише для активного бронювання', () => {
    expect(canCancelBooking('active')).toBe(true);
    for (const status of ['confirmed', 'cancelled_by_student', 'auto_cancelled', 'pending', '']) {
      expect(canCancelBooking(status), status).toBe(false);
    }
  });

  it('US-4.2-AC-01, US-X.3-AC-01: вкладка береться з адреси, невідоме значення дає «Майбутні»', () => {
    expect(parseBookingScope('past')).toBe('past');
    expect(parseBookingScope('upcoming')).toBe('upcoming');
    for (const value of [null, '', 'all', 'PAST']) {
      expect(parseBookingScope(value), String(value)).toBe('upcoming');
    }
  });
});
