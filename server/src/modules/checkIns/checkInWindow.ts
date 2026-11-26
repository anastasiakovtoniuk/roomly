import type { Prisma } from '../../generated/prisma/client';

// Вікно підтвердження присутності (BR-4, api_spec.md §8). Єдине місце цих меж для студентського
// check-in (#40) і ручного підтвердження адміністратором (#42).
//
// Q01/G4 [Рішення команди, checkin_admin_flow.md, рішення 4]:
// - раннього вікна немає: до `startsAt` — `too_early` (CHECK_IN_TOO_EARLY);
// - рівно в `deadline` вікно ще відкрите; та сама межа, що в автоскасуванні (`deadline < now`,
//   autoCancel.ts), тому обидві умови змінюються разом;
// - визначальний момент — серверний час обробки запиту (clock.ts), не клієнтський.
export type CheckInWindow = 'too_early' | 'open' | 'closed';

export function checkInWindow(slotStartsAt: Date, deadline: Date, at: Date): CheckInWindow {
  if (at.getTime() < slotStartsAt.getTime()) return 'too_early';
  if (deadline.getTime() < at.getTime()) return 'closed';
  return 'open';
}

// Умова умовного переходу `active` → `confirmed` для updateMany: той самий інтервал, що `open` вище.
// Перехід виконується одним оновленням за поточним станом, а не «перевірити → записати»: якщо
// автоскасування чи інше підтвердження виграло гонку, рядок умові вже не відповідає (SYS-AC-07).
export function confirmableWhere(at: Date): Prisma.BookingWhereInput {
  return { status: 'active', deadline: { gte: at }, slot: { startsAt: { lte: at } } };
}
