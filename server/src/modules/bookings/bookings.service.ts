import {
  BOOKING_STATUSES,
  GRACE_PERIOD_MINUTES,
  LIVE_BOOKING_STATUSES,
  USER_ROLES,
  type Booking,
  type BookingListResponse,
  type BookingResponse,
  type BookingScope,
  type BookingStatus,
  type UserRole,
} from '@roomly/shared';
import { prisma } from '../../db/prisma';
import { Prisma } from '../../generated/prisma/client';
import { AppError } from '../../lib/appError';
import { now } from '../../lib/clock';

const BOOKING_FIELDS = {
  id: true,
  status: true,
  deadline: true,
  createdAt: true,
  confirmedAt: true,
  cancelledAt: true,
  slot: {
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      room: { select: { id: true, name: true, building: true, floor: true } },
    },
  },
  confirmedBy: { select: { role: true } },
} as const satisfies Prisma.BookingSelect;

type BookingRecord = Prisma.BookingGetPayload<{ select: typeof BOOKING_FIELDS }>;

function isBookingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value);
}

function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

// Booking з api_spec.md §2: без даних власника; хто підтвердив — лише роль (US-5.2-AC-04).
function toApiBooking(record: BookingRecord): Booking {
  if (!isBookingStatus(record.status)) {
    throw new Error(`Невідомий статус бронювання ${record.id}: ${record.status}`);
  }
  const confirmedByRole = record.confirmedBy?.role ?? null;
  if (confirmedByRole !== null && !isUserRole(confirmedByRole)) {
    throw new Error(`Невідома роль того, хто підтвердив бронювання ${record.id}`);
  }
  const { slot } = record;
  return {
    id: record.id,
    status: record.status,
    room: slot.room,
    slot: { id: slot.id, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() },
    deadline: record.deadline.toISOString(),
    createdAt: record.createdAt.toISOString(),
    confirmedAt: record.confirmedAt?.toISOString() ?? null,
    confirmedBy: confirmedByRole,
    cancelledAt: record.cancelledAt?.toISOString() ?? null,
  };
}

// Єдине місце обчислення дедлайну (BR-3, data_model.md §3.4). Розпочатий слот не бронюється
// (G1/Q04 варіант «а», [Рішення команди] для booking_flow.md), тож дедлайн завжди від початку слота.
export function computeDeadline(slotStartsAt: Date): Date {
  return new Date(slotStartsAt.getTime() + GRACE_PERIOD_MINUTES * 60 * 1000);
}

// Порушення будь-якого унікального обмеження Booking. Єдине таке обмеження, крім id (UUID від Prisma),
// — частковий індекс BR-1 Booking_slotId_live_key.
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

// US-3.1, US-3.4. Власник — лише користувач сесії (BR-17, FB-11).
// Ліниве автоскасування з api_spec.md §1, §7 тут навмисно не викликається: у сценарії
// booking_flow.md воно вимкнене (issue #7), бронювання лишається active до скасування.
export async function createBooking(userId: string, slotId: string): Promise<BookingResponse> {
  const serverTime = now();

  const slot = await prisma.slot.findUnique({ where: { id: slotId }, select: { startsAt: true } });
  if (!slot) {
    throw new AppError('SLOT_NOT_FOUND', 'Слот не знайдено');
  }
  // BR-11 і G1/Q04 варіант «а»: слот, що почався чи завершився, не бронюється. Межа та сама,
  // що й у списку вільних слотів (rooms.service.ts: startsAt > now).
  if (slot.startsAt.getTime() <= serverTime.getTime()) {
    throw new AppError('SLOT_NOT_BOOKABLE', 'Слот уже почався або завершився');
  }

  // Вільність слота навмисно не перевіряється заздалегідь (TA-7): «перевірити → вставити»
  // пропускає паралельні запити. Друге живе бронювання відхиляє сховище (data_model.md §4.3).
  let record: BookingRecord;
  try {
    record = await prisma.booking.create({
      data: {
        userId,
        slotId,
        status: 'active',
        deadline: computeDeadline(slot.startsAt),
        createdAt: serverTime,
      },
      select: BOOKING_FIELDS,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError('SLOT_ALREADY_BOOKED', 'Слот уже заброньовано');
    }
    throw err;
  }

  return { booking: toApiBooking(record), serverTime: serverTime.toISOString() };
}

// Q12 [Рішення команди] для booking_flow.md: upcoming — живий статус і початок ще не настав;
// past — усі інші власні, зокрема поточне бронювання й момент рівно на початку слота.
function upcomingWhere(at: Date): Prisma.BookingWhereInput {
  return { status: { in: [...LIVE_BOOKING_STATUSES] }, slot: { startsAt: { gt: at } } };
}

// US-4.2, US-X.3: лише бронювання користувача сесії (BR-8).
export async function listMyBookings(userId: string, scope: BookingScope): Promise<BookingListResponse> {
  const serverTime = now();
  const upcoming = upcomingWhere(serverTime);
  const direction = scope === 'upcoming' ? 'asc' : 'desc';

  const records = await prisma.booking.findMany({
    where: { userId, ...(scope === 'upcoming' ? upcoming : { NOT: upcoming }) },
    select: BOOKING_FIELDS,
    orderBy: [{ slot: { startsAt: direction } }, { createdAt: direction }],
  });

  return { bookings: records.map(toApiBooking), serverTime: serverTime.toISOString() };
}

// Чуже й неіснуюче бронювання дають однакову відповідь, щоб не розкривати чужі записи (BR-8, US-X.1a-AC-03).
function bookingNotFound(): AppError {
  return new AppError('BOOKING_NOT_FOUND', 'Бронювання не знайдено');
}

// US-3.2a, US-3.2b.
export async function getMyBooking(userId: string, bookingId: string): Promise<BookingResponse> {
  const serverTime = now();
  const record = await prisma.booking.findFirst({ where: { id: bookingId, userId }, select: BOOKING_FIELDS });
  if (!record) {
    throw bookingNotFound();
  }
  return { booking: toApiBooking(record), serverTime: serverTime.toISOString() };
}

// US-4.3: одне умовне оновлення active → cancelled_by_student лише для власного запису (BR-6, ADR-0006).
// Статус наперед не читається: паралельне повторне скасування чи інший перехід просто не оновить рядок.
// Q07 [Рішення команди] для booking_flow.md: бронювання, що вже почалося, теж скасовується, поки воно active.
// Ліниве автоскасування не викликається: у сценарії booking_flow.md воно вимкнене.
export async function cancelMyBooking(userId: string, bookingId: string): Promise<BookingResponse> {
  const serverTime = now();
  const { count } = await prisma.booking.updateMany({
    where: { id: bookingId, userId, status: 'active' },
    data: { status: 'cancelled_by_student', cancelledAt: serverTime },
  });

  const record = await prisma.booking.findFirst({ where: { id: bookingId, userId }, select: BOOKING_FIELDS });
  if (!record) {
    throw bookingNotFound();
  }
  if (count === 0) {
    // Скасований запис не відновлюється, підтверджений не скасовується (FB-1, BR-9).
    throw new AppError('BOOKING_STATUS_CONFLICT', 'Дію неможливо виконати для бронювання в цьому статусі', {
      currentStatus: record.status,
    });
  }
  return { booking: toApiBooking(record), serverTime: serverTime.toISOString() };
}
