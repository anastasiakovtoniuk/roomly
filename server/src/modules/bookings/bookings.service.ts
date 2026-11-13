import {
  BOOKING_STATUSES,
  GRACE_PERIOD_MINUTES,
  USER_ROLES,
  type Booking,
  type BookingResponse,
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
// (G1/Q04 варіант «а», booking_flow.md), тож дедлайн завжди від початку слота. Якщо команда
// обере варіант «б», змінюється лише ця функція.
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
