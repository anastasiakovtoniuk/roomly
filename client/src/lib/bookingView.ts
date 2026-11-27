import {
  BOOKING_SCOPES,
  BOOKING_STATUSES,
  type Booking,
  type BookingScope,
  type BookingStatus,
} from '@roomly/shared';

// Відображення бронювань (US-4.2, US-X.3, US-4.3). Значення беруться з shared/, тут лише підписи.

const STATUS_LABELS: Readonly<Record<BookingStatus, string>> = {
  active: 'Активне',
  confirmed: 'Підтверджене',
  cancelled_by_student: 'Скасовано студентом',
  auto_cancelled: 'Автоскасоване',
};

export type BookingStatusTone = 'active' | 'confirmed' | 'cancelled' | 'autoCancelled' | 'unknown';

// Автоскасоване має окремий тон: студент має відрізнити його від власного скасування (US-X.3-AC-02).
const STATUS_TONES: Readonly<Record<BookingStatus, BookingStatusTone>> = {
  active: 'active',
  confirmed: 'confirmed',
  cancelled_by_student: 'cancelled',
  auto_cancelled: 'autoCancelled',
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

// Вкладки «Моїх бронювань» (checkin_admin_flow.md, рішення 5). «Активні» й «Минулі» — клієнтський
// поділ відповіді scope=past; нового значення scope в API немає.
export const BOOKING_TABS = ['upcoming', 'ongoing', 'past'] as const;
export type BookingTab = (typeof BOOKING_TABS)[number];

export function parseBookingTab(value: string | null): BookingTab {
  return BOOKING_TABS.find((tab) => tab === value) ?? 'upcoming';
}

export function bookingTabScope(tab: BookingTab): BookingScope {
  return tab === 'upcoming' ? 'upcoming' : 'past';
}

type BookingTiming = Pick<Booking, 'status' | 'slot' | 'deadline'>;

// Момент — серверний час (serverTime або його оцінка за countdown.ts), а не клієнтський годинник.
function toMs(value: string | number): number {
  return typeof value === 'number' ? value : Date.parse(value);
}

// US-5.4: повідомлення на початку бронювання — лише для active у межах [startsAt, deadline].
// Межі включно за рішенням 4 checkin_admin_flow.md (Q01/G4); тести межі не фіксують.
export function isStartNoticeDue(booking: BookingTiming, serverNow: string | number): boolean {
  const now = toMs(serverNow);
  return (
    booking.status === 'active' &&
    Date.parse(booking.slot.startsAt) <= now &&
    now <= Date.parse(booking.deadline)
  );
}

// US-4.1 за гіпотезою H02: нагадування за 24 години лише в застосунку. Точну межу й випадки Q05/G10
// (бронювання, створене менш ніж за добу; повторний показ) не закрито: показуємо, поки до початку
// не більше доби.
export const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isReminderDue(booking: BookingTiming, serverNow: string | number): boolean {
  const untilStart = Date.parse(booking.slot.startsAt) - toMs(serverNow);
  return booking.status === 'active' && untilStart > 0 && untilStart <= REMINDER_WINDOW_MS;
}

// Рішення 5 checkin_admin_flow.md (Q12): «Активні» — active або confirmed, слот почався й ще не
// завершився за serverTime; «Минулі» — решта відповіді scope=past. Порядок сервера зберігається.
export function isOngoingBooking(booking: BookingTiming, serverNow: string | number): boolean {
  const now = toMs(serverNow);
  return (
    (booking.status === 'active' || booking.status === 'confirmed') &&
    Date.parse(booking.slot.startsAt) <= now &&
    now < Date.parse(booking.slot.endsAt)
  );
}

export function splitStartedBookings<T extends BookingTiming>(
  bookings: readonly T[],
  serverNow: string | number,
): { ongoing: T[]; past: T[] } {
  const ongoing: T[] = [];
  const past: T[] = [];
  for (const booking of bookings) {
    (isOngoingBooking(booking, serverNow) ? ongoing : past).push(booking);
  }
  return { ongoing, past };
}
