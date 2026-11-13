import { BOOKING_SCOPES, BOOKING_STATUSES, type BookingScope, type BookingStatus } from '@roomly/shared';

// Відображення бронювань (US-4.2, US-X.3, US-4.3). Значення беруться з shared/, тут лише підписи.

const STATUS_LABELS: Readonly<Record<BookingStatus, string>> = {
  active: 'Активне',
  confirmed: 'Підтверджене',
  cancelled_by_student: 'Скасовано студентом',
  auto_cancelled: 'Автоскасовано',
};

export type BookingStatusTone = 'active' | 'confirmed' | 'cancelled' | 'unknown';

const STATUS_TONES: Readonly<Record<BookingStatus, BookingStatusTone>> = {
  active: 'active',
  confirmed: 'confirmed',
  cancelled_by_student: 'cancelled',
  auto_cancelled: 'cancelled',
};

function isKnownStatus(status: string): status is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(status);
}

// Перелік статусів розширюється за G2/Q03: невідоме значення показуємо нейтрально (api_spec.md §2).
export function bookingStatusLabel(status: string): string {
  return isKnownStatus(status) ? STATUS_LABELS[status] : 'Статус невідомий';
}

export function bookingStatusTone(status: string): BookingStatusTone {
  return isKnownStatus(status) ? STATUS_TONES[status] : 'unknown';
}

// Студент скасовує лише активне бронювання; підтверджене й кінцеві статуси не скасовуються
// (api_spec.md §7, BR-9, FB-1). Остаточне рішення завжди за сервером.
export function canCancelBooking(status: string): boolean {
  return status === 'active';
}

// Вкладка списку береться з адреси; невідоме значення дає «Майбутні».
export function parseBookingScope(value: string | null): BookingScope {
  return BOOKING_SCOPES.find((scope) => scope === value) ?? 'upcoming';
}
