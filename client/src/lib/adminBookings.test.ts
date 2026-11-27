import { BOOKING_STATUSES, ERROR_CODES, ERROR_HTTP_STATUS, type CheckInResult } from '@roomly/shared';
import { describe, expect, it } from 'vitest';
import { getErrorMessage } from '../api/errorMessages';
import { ApiError, NetworkError } from '../api/http';
import {
  canConfirmManually,
  confirmedByLabel,
  manualConfirmFailure,
  manualConfirmSuccess,
} from './adminBookings';

// Допоміжна логіка /admin/bookings (#46); показ і ручні кроки перевіряє чекліст #53.

function checkInResult(result: CheckInResult['result']): CheckInResult {
  return {
    result,
    booking: {
      id: 'booking-1',
      status: 'confirmed',
      room: { id: 'room-1', name: 'R101', building: 'Корпус 1', floor: 2 },
      slot: { id: 'slot-1', startsAt: '2026-11-03T12:00:00.000Z', endsAt: '2026-11-03T13:00:00.000Z' },
      deadline: '2026-11-03T12:15:00.000Z',
      createdAt: '2026-11-01T09:30:00.000Z',
      confirmedAt: '2026-11-03T12:05:00.000Z',
      confirmedBy: 'admin',
      cancelledAt: null,
    },
    serverTime: '2026-11-03T12:05:00.000Z',
  };
}

// Коди, після яких стан бронювання на сервері міг змінитися: список треба перечитати.
const REFRESH_CODES = new Set(['CHECK_IN_WINDOW_CLOSED', 'BOOKING_STATUS_CONFLICT', 'BOOKING_NOT_FOUND']);

describe('Ручне підтвердження в списку адміністратора', () => {
  it('US-A.7-AC-01: кнопку «Підтвердити вручну» має лише активне бронювання', () => {
    expect(canConfirmManually('active')).toBe(true);
    for (const status of [...BOOKING_STATUSES.filter((s) => s !== 'active'), 'pending', '']) {
      expect(canConfirmManually(status), status).toBe(false);
    }
  });

  it('US-A.7-AC-01, Q06: обидва результати — успіх, і список перечитується', () => {
    const confirmed = manualConfirmSuccess(checkInResult('confirmed'));
    const already = manualConfirmSuccess(checkInResult('already_confirmed'));
    expect(confirmed).toMatchObject({ tone: 'ok', refresh: true });
    expect(already).toMatchObject({ tone: 'ok', refresh: true });
    expect(confirmed.message).not.toBe(already.message);
  });

  it('US-A.7-AC-02…03: для кожного коду помилки — текст за кодом і рішення про перечитування', () => {
    for (const code of ERROR_CODES) {
      const error = new ApiError(ERROR_HTTP_STATUS[code], code, 'текст сервера не показується');
      const outcome = manualConfirmFailure(error);
      expect(outcome.tone, code).toBe('error');
      expect(outcome.message, code).toBe(getErrorMessage(error));
      expect(outcome.message, code).not.toContain('текст сервера');
      expect(outcome.refresh, code).toBe(REFRESH_CODES.has(code));
    }
  });

  it('Q11: після втраченої відповіді результат невідомий — список перечитується, успіх не показується', () => {
    const outcome = manualConfirmFailure(new NetworkError(new TypeError('Failed to fetch')));
    expect(outcome).toMatchObject({ tone: 'error', refresh: true });
    expect(outcome.message).toBe(getErrorMessage(new NetworkError(null)));
  });

  it('Помилка без коду сервера не перечитує список і показує загальний текст', () => {
    expect(manualConfirmFailure(new Error('збій'))).toEqual({
      tone: 'error',
      message: getErrorMessage(null),
      refresh: false,
    });
  });
});

describe('Підпис способу підтвердження', () => {
  it('US-A.5-AC-01: «за QR» для студента, «вручну» для адміністратора', () => {
    expect(confirmedByLabel('student')).toBe('за QR');
    expect(confirmedByLabel('admin')).toBe('вручну');
  });

  it('US-A.5-AC-01: невідоме значення, зокрема службові ключі об’єкта, не дає підпису', () => {
    for (const value of [null, '', 'system', 'toString', '__proto__']) {
      expect(confirmedByLabel(value), String(value)).toBeNull();
    }
  });
});
