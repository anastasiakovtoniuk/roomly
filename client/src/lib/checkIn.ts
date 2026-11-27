import type { Booking, CheckInResult, ErrorCode } from '@roomly/shared';
import { getErrorMessage, getErrorMessageByCode } from '../api/errorMessages';
import { ApiError, NetworkError } from '../api/http';

// Стан екрана підтвердження присутності за відповіддю POST /api/check-ins (US-5.1, US-5.6a/b).
// Функції не залежать від React: їх перевіряє #52. Рішення про вікно підтвердження завжди
// за сервером, клієнт лише показує результат.

export type CheckInScreenState =
  | { kind: 'confirmed'; booking: Booking; retry: false }
  | { kind: 'already_confirmed'; booking: Booking; retry: false }
  | { kind: 'window_closed'; retry: false }
  | { kind: 'too_early'; retry: false }
  | { kind: 'no_booking'; retry: false }
  | { kind: 'qr_unknown'; retry: false }
  // delivery: 'not_sent' — пристрій офлайн, отже запит не дійшов і підтвердження не збережено
  // (US-5.6a-AC-01). 'unknown' — відповіді немає, але запит міг дійти: стверджувати «не збережено»
  // не можна (Q11). В обох випадках повтор безпечний: збережена раніше спроба дасть
  // already_confirmed (BR-10, TA-9).
  | { kind: 'network'; delivery: 'not_sent' | 'unknown'; retry: true }
  | { kind: 'unknown'; error: unknown; retry: false };

export type CheckInScreenKind = CheckInScreenState['kind'];

// Обидва результати успішні (BR-10): повтор уже підтвердженого не є помилкою.
export function checkInStateFromResult(response: CheckInResult): CheckInScreenState {
  return response.result === 'already_confirmed'
    ? { kind: 'already_confirmed', booking: response.booking, retry: false }
    : { kind: 'confirmed', booking: response.booking, retry: false };
}

// `offline` — значення navigator.onLine === false на момент помилки; передається явно, щоб
// функція лишалася чистою.
export function checkInStateFromError(error: unknown, { offline }: { offline: boolean }): CheckInScreenState {
  if (error instanceof NetworkError) {
    return { kind: 'network', delivery: offline ? 'not_sent' : 'unknown', retry: true };
  }
  if (error instanceof ApiError) {
    // Повтор після дедлайну не відновлює бронювання (US-5.6b-AC-03), тому кнопки повтору немає.
    const kind = (Object.keys(STATE_ERROR_CODES) as (keyof typeof STATE_ERROR_CODES)[]).find(
      (key) => STATE_ERROR_CODES[key] === error.code,
    );
    if (kind) return { kind, retry: false };
  }
  return { kind: 'unknown', error, retry: false };
}

// Стан до надсилання: офлайн-пристрій не надсилає запит, а одразу повідомляє, що підтвердження
// не збережено (US-5.6a-AC-01, api_spec.md §8 «Мережа»).
export function offlineCheckInState(): CheckInScreenState {
  return { kind: 'network', delivery: 'not_sent', retry: true };
}

export function isCheckInSuccess(
  state: CheckInScreenState,
): state is Extract<CheckInScreenState, { kind: 'confirmed' | 'already_confirmed' }> {
  return state.kind === 'confirmed' || state.kind === 'already_confirmed';
}

// Код помилки сервера для кожного стану: опис береться з errorMessages.ts за кодом, а не з message
// відповіді (error_format.md §1), і той самий текст бачить адміністратор (#46).
const STATE_ERROR_CODES = {
  window_closed: 'CHECK_IN_WINDOW_CLOSED',
  too_early: 'CHECK_IN_TOO_EARLY',
  no_booking: 'NO_CURRENT_BOOKING',
  qr_unknown: 'QR_UNKNOWN',
} as const satisfies Partial<Record<CheckInScreenKind, ErrorCode>>;

// Тексти робочі: формулювання для повтору (Q11) і помилок підтвердження (Q13, Q15) не погоджені.
export function checkInStateText(state: CheckInScreenState): { title: string; description: string } {
  switch (state.kind) {
    case 'confirmed':
      return {
        title: 'Присутність підтверджено',
        description: 'Бронювання тепер має статус «Підтверджене».',
      };
    case 'already_confirmed':
      return {
        title: 'Бронювання вже підтверджене',
        description: 'Присутність у цій кімнаті вже підтвердили раніше, нічого не змінилося.',
      };
    case 'window_closed':
      return {
        title: 'Час підтвердження минув',
        description: `${getErrorMessageByCode(STATE_ERROR_CODES.window_closed)} Повтор його не відновить.`,
      };
    case 'too_early':
      return {
        title: 'Ще зарано',
        description: `${getErrorMessageByCode(STATE_ERROR_CODES.too_early)} Скануй QR після початку слота.`,
      };
    case 'no_booking':
      return {
        title: 'Немає поточного бронювання',
        description: `${getErrorMessageByCode(STATE_ERROR_CODES.no_booking)} Перевір кімнату й час.`,
      };
    case 'qr_unknown':
      return {
        title: 'QR-код не розпізнано',
        description: `${getErrorMessageByCode(STATE_ERROR_CODES.qr_unknown)} Скануй QR, що висить у кімнаті.`,
      };
    case 'network':
      return state.delivery === 'not_sent'
        ? {
            title: 'Підтвердження не збережено: немає зв’язку',
            description:
              'Бронювання лишається активним. Віднови з’єднання й натисни «Повторити» до дедлайну підтвердження.',
          }
        : {
            title: 'Немає відповіді від сервера',
            description:
              'Невідомо, чи збереглося підтвердження. Перевір з’єднання й натисни «Повторити»: повторний запит не створить дубля.',
          };
    case 'unknown':
      return { title: 'Не вдалося підтвердити присутність', description: getErrorMessage(state.error) };
  }
}
