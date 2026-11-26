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
    select: { id: true, status: true, deadline: true, slot: { select: { startsAt: true } } },
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

  let result: CheckInResult['result'] = 'already_confirmed';
  if (current.status === 'active') {
    if (checkInWindow(current.slot.startsAt, current.deadline, serverTime) === 'closed') {
      throw windowClosed();
    }
    const { count } = await prisma.booking.updateMany({
      where: { id: current.id, ...confirmableWhere(serverTime) },
      data: { status: 'confirmed', confirmedAt: serverTime, confirmedById: scannerId },
    });
    if (count === 1) {
      result = 'confirmed';
    }
  }

  // Стан після операції. Якщо умовне оновлення не змінило рядок, конкурентна дія вже вирішила
  // результат (SYS-AC-07): `confirmed` — повтор без змін (BR-10), інакше підтвердження неможливе.
  const record = await prisma.booking.findUniqueOrThrow({
    where: { id: current.id },
    select: BOOKING_FIELDS,
  });
  if (record.status === 'cancelled_by_student') {
    throw noCurrentBooking();
  }
  if (record.status !== 'confirmed') {
    throw windowClosed();
  }
  return { result, booking: toApiBooking(record), serverTime: serverTime.toISOString() };
}
