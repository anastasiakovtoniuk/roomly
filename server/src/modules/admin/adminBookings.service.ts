import type { AdminBookingListResponse, CheckInResult } from '@roomly/shared';
import { prisma } from '../../db/prisma';
import type { Prisma } from '../../generated/prisma/client';
import { AppError } from '../../lib/appError';
import { now } from '../../lib/clock';
import { cancelExpiredBookings } from '../bookings/autoCancel';
import { BOOKING_FIELDS, toApiBooking } from '../bookings/bookings.service';
import { confirmCurrentBooking } from '../checkIns/checkIns.service';

// Бронювання для адміністратора (api_spec.md §9, US-A.5, US-A.7). Роль перевіряє роутер.
// Адмін-скасування (US-A.6) поза обсягом: його статус залежить від G2/Q03, Q18.

// Booking + власник (AdminBooking): лише id, ім'я й пошта, без passwordHash і сесій (BR-8).
const ADMIN_BOOKING_FIELDS = {
  ...BOOKING_FIELDS,
  user: { select: { id: true, name: true, email: true } },
} as const satisfies Prisma.BookingSelect;

// US-A.5. Ліниве автоскасування перед читанням (ADR-0006): прострочене `active` у відповіді вже
// `auto_cancelled`. Порядок — спадання `slot.startsAt` ([Пропозиція] api_spec.md §9); однаковий
// початок упорядковується за id, щоб відповідь була стабільною. Без фільтрів і пагінації (FB-15, TA-13).
export async function listAllBookings(): Promise<AdminBookingListResponse> {
  const serverTime = now();
  await cancelExpiredBookings(serverTime);

  const records = await prisma.booking.findMany({
    select: ADMIN_BOOKING_FIELDS,
    orderBy: [{ slot: { startsAt: 'desc' } }, { id: 'asc' }],
  });

  return {
    bookings: records.map((record) => ({
      ...toApiBooking(record),
      student: { id: record.user.id, name: record.user.name, email: record.user.email },
    })),
    serverTime: serverTime.toISOString(),
  };
}

// US-A.7. Те саме умовне оновлення й та сама функція вікна, що в check-in (#40): confirmCurrentBooking
// і checkInWindow/confirmableWhere не дублюються. Відмінності від студента (api_spec.md §9):
// бронювання задане id (немає → BOOKING_NOT_FOUND); скасоване студентом — 409 BOOKING_STATUS_CONFLICT
// з details.currentStatus, а не NO_CURRENT_BOOKING. confirmedById — адміністратор лише із сесії (BR-17),
// тож у відповіді confirmedBy: "admin". Повтор — already_confirmed без змін ([Пропозиція] Q06).
export async function confirmBooking(bookingId: string, adminId: string): Promise<CheckInResult> {
  const serverTime = now();
  // Ліниве автоскасування (api_spec.md §1): прострочене `active` стає `auto_cancelled` до рішення,
  // далі confirmCurrentBooking відповідає CHECK_IN_WINDOW_CLOSED.
  await cancelExpiredBookings(serverTime);

  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true } });
  if (!booking) {
    throw new AppError('BOOKING_NOT_FOUND', 'Бронювання не знайдено');
  }

  try {
    return await confirmCurrentBooking(bookingId, adminId, serverTime);
  } catch (err) {
    // NO_CURRENT_BOOKING — відповідь студентського check-in на скасований запис; для адміністратора
    // контракт дає BOOKING_STATUS_CONFLICT. Статус перечитується, а не підставляється, щоб
    // details.currentStatus відповідав БД, навіть якщо скасування виграло гонку з підтвердженням.
    if (err instanceof AppError && err.code === 'NO_CURRENT_BOOKING') {
      const { status } = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: { status: true },
      });
      throw new AppError('BOOKING_STATUS_CONFLICT', 'Дію неможливо виконати для бронювання в цьому статусі', {
        currentStatus: status,
      });
    }
    throw err;
  }
}
