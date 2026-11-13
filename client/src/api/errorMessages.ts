import type { ErrorCode } from '@roomly/shared';
import { ApiError, NetworkError } from './http';

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Перевір введені дані та спробуй ще раз.',
  UNAUTHENTICATED: 'Увійди в акаунт, щоб продовжити.',
  INVALID_CREDENTIALS: 'Неправильна пошта або пароль.',
  FORBIDDEN: 'У цього акаунта немає доступу до цієї дії.',
  ROOM_NOT_FOUND: 'Кімнату не знайдено. Онови список кімнат.',
  SLOT_NOT_FOUND: 'Слот не знайдено. Онови список доступного часу.',
  BOOKING_NOT_FOUND: 'Бронювання не знайдено або воно недоступне цьому акаунту.',
  ENDPOINT_NOT_FOUND: 'Сторінка або дія недоступна.',
  EMAIL_ALREADY_REGISTERED: 'Ця пошта вже зареєстрована. Спробуй увійти.',
  SLOT_ALREADY_BOOKED: 'Слот щойно зайняли. Обери інший час.',
  SLOT_NOT_BOOKABLE: 'Цей слот уже почався або завершився. Обери інший час.',
  SLOT_OVERLAP: 'Цей час перетинається з іншим слотом.',
  BOOKING_STATUS_CONFLICT: 'Стан бронювання змінився. Онови його перед наступною дією.',
  QR_UNKNOWN: 'QR-код не розпізнано.',
  NO_CURRENT_BOOKING: 'Для цієї кімнати немає поточного бронювання.',
  CHECK_IN_WINDOW_CLOSED: 'Час підтвердження присутності минув.',
  CHECK_IN_TOO_EARLY: 'Час підтвердження присутності ще не настав.',
  INTERNAL_ERROR: 'Не вдалося виконати дію. Спробуй пізніше.',
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof NetworkError) {
    // Втрата відповіді не доводить, що запису немає (Q11).
    return 'Немає відповіді від сервера. Перевір з’єднання. Якщо ти виконував дію, перевір її результат перед повтором.';
  }
  if (error instanceof ApiError) {
    return ERROR_MESSAGES[error.code] ?? ERROR_MESSAGES.INTERNAL_ERROR;
  }
  return ERROR_MESSAGES.INTERNAL_ERROR;
}
