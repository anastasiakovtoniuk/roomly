import { type CheckInResult } from '@roomly/shared';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/appError';
import { now } from '../../lib/clock';
import { cancelExpiredBookings } from '../bookings/autoCancel';
import { BOOKING_FIELDS, toApiBooking } from '../bookings/bookings.service';
import { checkInWindow, confirmableWhere } from './checkInWindow';

// Статуси, серед яких шукається поточне бронювання (api_spec.md §8, крок 3). Скасоване студентом
// не враховується й дає NO_CURRENT_BOOKING. Живий запис має пріоритет перед автоскасованим.
const CURRENT_BOOKING_STATUSES = ['confirmed', 'active', 'auto_cancelled'] as const;

function windowClosed(): AppError {
  return new AppError('CHECK_IN_WINDOW_CLOSED', 'Час підтвердження минув');
}

function noCurrentBooking(): AppError {
  return new AppError('NO_CURRENT_BOOKING', 'У кімнаті немає поточного бронювання');
}

// US-5.1, US-5.2, US-5.6b. QR ідентифікує кімнату; підтвердити може будь-який студент, не лише
// власник (BR-4, [Рішення команди]). Власник не змінюється, `confirmedById` — той, хто скануює
// (лише із сесії, BR-17). Відповідь — Booking без даних власника (BR-8, FB-12); `qrToken` не
// повертається й не логується.
export async function checkIn(scannerId: string, qrToken: string): Promise<CheckInResult> {
  const serverTime = now();

  const room = await prisma.room.findUnique({ where: { qrToken }, select: { id: true } });
  if (!room) {
    throw new AppError('QR_UNKNOWN', 'QR-код не належить жодній кімнаті');
  }

  // Ліниве автоскасування (ADR-0006): прострочене `active` стає `auto_cancelled` до рішення.
  await cancelExpiredBookings(serverTime);

  // Слоти однієї кімнати не перетинаються (SLOT_OVERLAP), тож поточний слот один; на ньому може бути
  // не більше одного живого запису (BR-1) і довільна кількість скасованих.
  const candidates = await prisma.booking.findMany({
    where: {
      status: { in: [...CURRENT_BOOKING_STATUSES] },
      slot: { roomId: room.id, startsAt: { lte: serverTime }, endsAt: { gt: serverTime } },
    },
    select: { id: true, status: true },
  });
  const current =
    candidates.find((booking) => booking.status !== 'auto_cancelled') ?? candidates.at(0) ?? null;

  if (!current) {
    // Раннього вікна немає (Q01 [Рішення команди]): бронювання, що ще не почалося, — CHECK_IN_TOO_EARLY.
    const upcoming = await prisma.booking.findFirst({
      where: { status: 'active', slot: { roomId: room.id, startsAt: { gt: serverTime } } },
      select: { id: true },
    });
    throw upcoming ? new AppError('CHECK_IN_TOO_EARLY', 'Бронювання ще не почалося') : noCurrentBooking();
  }

  if (current.status === 'auto_cancelled') {
    // Автоскасований запис не відновлюється (US-5.1-AC-06, US-5.6b-AC-03).
    throw windowClosed();
  }
  return confirmCurrentBooking(current.id, scannerId, serverTime);
}

// Умовний перехід `active` → `confirmed` і стан після нього. Викликається для запису, щойно
// прочитаного як `active` чи `confirmed`; між читанням і оновленням конкурентна дія (автоскасування,
// інше підтвердження, скасування студентом) може змінити рядок. Одне умовне updateMany, а не
// «перевірити → записати»: рядок, що вже не відповідає умові, не переписується (SYS-AC-07).
// Експортовано, щоб тест детерміновано відтворив програну гонку справжнім записом у БД без підміни Prisma.
export async function confirmCurrentBooking(
  bookingId: string,
  confirmedById: string,
  at: Date,
): Promise<CheckInResult> {
  const { count } = await prisma.booking.updateMany({
    where: { id: bookingId, ...confirmableWhere(at) },
    data: { status: 'confirmed', confirmedAt: at, confirmedById },
  });

  const record = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: BOOKING_FIELDS,
  });
  switch (record.status) {
    case 'confirmed':
      // Повтор чи програна гонка з іншим підтвердженням — без змін (BR-10).
      return {
        result: count === 1 ? 'confirmed' : 'already_confirmed',
        booking: toApiBooking(record),
        serverTime: at.toISOString(),
      };
    case 'cancelled_by_student':
      throw noCurrentBooking();
    case 'auto_cancelled':
      throw windowClosed();
    case 'active': {
      const state = checkInWindow(record.slot.startsAt, record.deadline, at);
      if (state === 'closed') throw windowClosed();
      if (state === 'too_early') throw new AppError('CHECK_IN_TOO_EARLY', 'Бронювання ще не почалося');
      // `active` у відкритому вікні, але умова оновлення його не взяла: розбіжність між
      // checkInWindow і confirmableWhere. Це помилка сервера, а не закрите вікно для студента.
      throw new Error(`Бронювання ${bookingId} у відкритому вікні не підтверджено`);
    }
    default:
      throw new Error(`Невідомий статус бронювання ${bookingId}: ${record.status}`);
  }
}
