import type { CheckInResult, UserRole } from '@roomly/shared';
import { getErrorMessage } from '../api/errorMessages';
import { ApiError, NetworkError } from '../api/http';

// Чиста логіка списку бронювань адміністратора (US-A.5, US-A.7). Чи відкрите вікно
// підтвердження, вирішує сервер: клієнт лише пропонує дію для активного бронювання.

export function canConfirmManually(status: string): boolean {
  return status === 'active';
}

const CONFIRMED_BY_LABELS: Readonly<Record<UserRole, string>> = {
  student: 'за QR',
  admin: 'вручну',
};

export function confirmedByLabel(confirmedBy: string | null): string | null {
  if (confirmedBy === 'student' || confirmedBy === 'admin') return CONFIRMED_BY_LABELS[confirmedBy];
  return null;
}

export type ManualConfirmOutcome = {
  tone: 'ok' | 'error';
  message: string;
  // Статус міг змінитися на сервері (автоскасування, конкурентна дія, втрачена відповідь):
  // список треба перечитати, а не вгадувати стан на клієнті.
  refresh: boolean;
};

// Обидва результати успішні (BR-10, Q06).
export function manualConfirmSuccess(response: CheckInResult): ManualConfirmOutcome {
  return response.result === 'already_confirmed'
    ? { tone: 'ok', message: 'Бронювання вже було підтверджене, нічого не змінилося.', refresh: true }
    : { tone: 'ok', message: 'Присутність підтверджено вручну.', refresh: true };
}

// Текст — за кодом помилки (error_format.md §1). Після мережевої помилки результат невідомий (Q11),
// тому список перечитується, а не показується «не збережено».
export function manualConfirmFailure(error: unknown): ManualConfirmOutcome {
  const refresh =
    error instanceof NetworkError ||
    (error instanceof ApiError &&
      (error.code === 'CHECK_IN_WINDOW_CLOSED' ||
        error.code === 'BOOKING_STATUS_CONFLICT' ||
        error.code === 'BOOKING_NOT_FOUND'));
  return { tone: 'error', message: getErrorMessage(error), refresh };
}
