import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { GRACE_PERIOD_MINUTES, type BookingStatus, type UserRole } from '@roomly/shared';
import { prisma } from '../../src/db/prisma';
import { HOUR_MS, MINUTE_MS } from './time';

// Тестова база спільна для всіх файлів і не очищується (ADR-0008): кожна фабрика створює записи з
// унікальними назвами, поштою й токенами, а тести шукають лише власні записи.

export const TEST_PASSWORD = 'secret-pass';

export async function createRoom(
  overrides: {
    name?: string;
    capacity?: number;
    building?: string;
    floor?: number;
    equipment?: string[];
  } = {},
) {
  return prisma.room.create({
    data: {
      name: overrides.name ?? `Кімната ${randomUUID()}`,
      capacity: overrides.capacity ?? 6,
      building: overrides.building ?? 'Корпус 1',
      floor: overrides.floor ?? 2,
      equipment: JSON.stringify(overrides.equipment ?? []),
      qrToken: `qr-${randomUUID()}`,
    },
  });
}

export async function createSlot(roomId: string, startsAt: Date | string, hours = 1) {
  const start = new Date(startsAt);
  return prisma.slot.create({
    data: { roomId, startsAt: start, endsAt: new Date(start.getTime() + hours * HOUR_MS) },
  });
}

// Користувач напряму в БД. Пароль за замовчуванням TEST_PASSWORD; cost 4 лише для швидкості тестів.
export async function createUser(options: { role?: UserRole; name?: string; password?: string } = {}) {
  const role = options.role ?? 'student';
  const password = options.password ?? TEST_PASSWORD;
  const user = await prisma.user.create({
    data: {
      name: options.name ?? 'Тест',
      email: `${role}-${randomUUID()}@example.com`,
      passwordHash: await bcrypt.hash(password, 4),
      role,
    },
  });
  return { ...user, password };
}

// Бронювання напряму через Prisma: для станів, яких не можна отримати через API (`confirmed`,
// `auto_cancelled`). Відсутні кімнату, слот і власника створює сама. Дедлайн за замовчуванням —
// початок слота + grace period (H01), як у `computeDeadline`.
export async function createBookingRow(
  status: BookingStatus,
  options: {
    startsAt?: Date | string;
    slotId?: string;
    userId?: string;
    deadline?: Date;
    createdAt?: Date;
    confirmedById?: string;
  } = {},
) {
  const slot =
    options.slotId !== undefined
      ? await prisma.slot.findUniqueOrThrow({ where: { id: options.slotId } })
      : await createSlot((await createRoom()).id, options.startsAt ?? '2026-11-03T08:00:00.000Z');
  const userId = options.userId ?? (await createUser()).id;
  const deadline = options.deadline ?? new Date(slot.startsAt.getTime() + GRACE_PERIOD_MINUTES * MINUTE_MS);
  const createdAt = options.createdAt ?? new Date(slot.startsAt.getTime() - 24 * HOUR_MS);
  return prisma.booking.create({
    data: {
      userId,
      slotId: slot.id,
      status,
      deadline,
      createdAt,
      ...(status === 'confirmed'
        ? { confirmedAt: deadline, confirmedById: options.confirmedById ?? null }
        : {}),
      ...(status === 'cancelled_by_student' || status === 'auto_cancelled' ? { cancelledAt: deadline } : {}),
    },
  });
}
