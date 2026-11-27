import { ERROR_CODES, ERROR_HTTP_STATUS, type CheckInResult } from '@roomly/shared';
import { describe, expect, it } from 'vitest';
import { getErrorMessageByCode } from '../api/errorMessages';
import { ApiError, NetworkError } from '../api/http';
import {
  checkInStateFromError,
  checkInStateFromResult,
  checkInStateText,
  isCheckInSuccess,
  offlineCheckInState,
  type CheckInScreenState,
} from './checkIn';

// Стан екрана підтвердження (#43) за відповіддю POST /api/check-ins. Перелік тестів — з AC
// US-5.1, US-5.6a, US-5.6b та issue #52; показ і камеру перевіряє ручний чекліст #53.

function result(kind: CheckInResult['result']): CheckInResult {
  return {
    result: kind,
    booking: {
      id: 'booking-1',
      status: 'confirmed',
      room: { id: 'room-1', name: 'R101', building: 'Корпус 1', floor: 2 },
      slot: { id: 'slot-1', startsAt: '2026-11-03T12:00:00.000Z', endsAt: '2026-11-03T13:00:00.000Z' },
      deadline: '2026-11-03T12:15:00.000Z',
      createdAt: '2026-11-01T09:30:00.000Z',
      confirmedAt: '2026-11-03T12:05:00.000Z',
      confirmedBy: 'student',
      cancelledAt: null,
    },
    serverTime: '2026-11-03T12:05:00.000Z',
  };
}

function apiError(code: (typeof ERROR_CODES)[number]): ApiError {
  return new ApiError(ERROR_HTTP_STATUS[code], code, 'текст сервера не показується');
}

const network = new NetworkError(new TypeError('Failed to fetch'));

describe('Стан екрана підтвердження присутності', () => {
  it('US-5.1-AC-01: прийнятий скан — успіх «підтверджено» з бронюванням із відповіді', () => {
    const response = result('confirmed');
    const state = checkInStateFromResult(response);
    expect(state.kind).toBe('confirmed');
    expect(isCheckInSuccess(state)).toBe(true);
    if (isCheckInSuccess(state)) expect(state.booking).toBe(response.booking);
    expect(state.retry).toBe(false);
  });

  it('US-5.1-AC-05: повтор уже підтвердженого — нейтральний успіх, а не помилка (BR-10)', () => {
    const state = checkInStateFromResult(result('already_confirmed'));
    expect(state.kind).toBe('already_confirmed');
    expect(isCheckInSuccess(state)).toBe(true);
    expect(checkInStateText(state).title).not.toBe(
      checkInStateText(checkInStateFromResult(result('confirmed'))).title,
    );
  });

  it('US-5.1-AC-03: невідомий QR — стан qr_unknown без успіху й без повтору', () => {
    const state = checkInStateFromError(apiError('QR_UNKNOWN'), { offline: false });
    expect(state).toEqual({ kind: 'qr_unknown', retry: false });
    expect(isCheckInSuccess(state)).toBe(false);
  });

  it('US-5.1-AC-04: у кімнаті немає поточного бронювання — стан no_booking без успіху', () => {
    const state = checkInStateFromError(apiError('NO_CURRENT_BOOKING'), { offline: false });
    expect(state).toEqual({ kind: 'no_booking', retry: false });
    expect(isCheckInSuccess(state)).toBe(false);
  });

  it('US-5.1-AC-04 (Q01): бронювання ще не почалося — стан too_early без успіху', () => {
    const state = checkInStateFromError(apiError('CHECK_IN_TOO_EARLY'), { offline: false });
    expect(state).toEqual({ kind: 'too_early', retry: false });
    expect(isCheckInSuccess(state)).toBe(false);
  });

  it('US-5.1-AC-06, US-5.6b-AC-03: після дедлайну — «вікно закрите» без кнопки повтору', () => {
    const state = checkInStateFromError(apiError('CHECK_IN_WINDOW_CLOSED'), { offline: false });
    expect(state).toEqual({ kind: 'window_closed', retry: false });
    expect(isCheckInSuccess(state)).toBe(false);
  });

  it('US-5.6a-AC-01: без мережі до надсилання — «підтвердження не збережено» з можливістю повтору', () => {
    for (const state of [offlineCheckInState(), checkInStateFromError(network, { offline: true })]) {
      expect(state).toEqual({ kind: 'network', delivery: 'not_sent', retry: true });
      expect(checkInStateText(state).title).toContain('не збережено');
    }
  });

  it('US-5.6a-AC-02: локальне сканування без доставки не дає успіху', () => {
    expect(isCheckInSuccess(offlineCheckInState())).toBe(false);
    expect(isCheckInSuccess(checkInStateFromError(network, { offline: true }))).toBe(false);
    expect(isCheckInSuccess(checkInStateFromError(network, { offline: false }))).toBe(false);
  });

  it('Q11: відповідь втрачено при мережі — результат невідомий, «не збережено» не стверджується', () => {
    const state = checkInStateFromError(network, { offline: false });
    expect(state).toEqual({ kind: 'network', delivery: 'unknown', retry: true });
    expect(checkInStateText(state).title).not.toContain('не збережено');
  });

  it('US-5.6b-AC-01: повтор пропонується лише після мережевої помилки', () => {
    const states: CheckInScreenState[] = [
      checkInStateFromResult(result('confirmed')),
      checkInStateFromResult(result('already_confirmed')),
      ...ERROR_CODES.map((code) => checkInStateFromError(apiError(code), { offline: false })),
    ];
    for (const state of states) expect(state.retry, state.kind).toBe(false);
    expect(checkInStateFromError(network, { offline: false }).retry).toBe(true);
    expect(checkInStateFromError(network, { offline: true }).retry).toBe(true);
  });

  it('error_format.md §1: помилки підтвердження показуються текстом за кодом, а не message сервера', () => {
    const cases = [
      ['QR_UNKNOWN', 'qr_unknown'],
      ['NO_CURRENT_BOOKING', 'no_booking'],
      ['CHECK_IN_TOO_EARLY', 'too_early'],
      ['CHECK_IN_WINDOW_CLOSED', 'window_closed'],
    ] as const;
    for (const [code] of cases) {
      const text = checkInStateText(checkInStateFromError(apiError(code), { offline: false }));
      expect(text.description, code).toContain(getErrorMessageByCode(code));
      expect(text.description, code).not.toContain('текст сервера');
    }
  });

  it('Інші коди й помилки без коду — стан unknown із текстом за кодом, без успіху', () => {
    const handled = new Set([
      'QR_UNKNOWN',
      'NO_CURRENT_BOOKING',
      'CHECK_IN_TOO_EARLY',
      'CHECK_IN_WINDOW_CLOSED',
    ]);
    for (const code of ERROR_CODES.filter((c) => !handled.has(c))) {
      const state = checkInStateFromError(apiError(code), { offline: false });
      expect(state.kind, code).toBe('unknown');
      expect(checkInStateText(state).description, code).toBe(getErrorMessageByCode(code));
    }
    expect(checkInStateFromError(new Error('збій'), { offline: false }).kind).toBe('unknown');
  });
});
