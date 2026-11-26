import { randomBytes } from 'node:crypto';
import type { CreateRoomBody, QrTokenResponse, Room, Slot, UpdateRoomBody } from '@roomly/shared';
import { prisma } from '../../db/prisma';
import { Prisma } from '../../generated/prisma/client';
import { AppError } from '../../lib/appError';
import { now } from '../../lib/clock';
import { toLocalDate } from '../../lib/localDate';
import { ROOM_FIELDS, toApiRoom } from '../rooms/rooms.service';

// Адміністрування кімнат і слотів (api_spec.md §9, US-A.1a, US-A.1b, US-A.2, US-A.4a).
// Роль перевіряє роутер; сервіс отримує лише вже перевірені схемами shared/ дані.

function roomNotFound(): AppError {
  return new AppError('ROOM_NOT_FOUND', 'Кімнату не знайдено');
}

// P2025 — запис для update не знайдено; P2003 — порушено зовнішній ключ (кімнати слота немає).
function isPrismaError(err: unknown, code: 'P2003' | 'P2025'): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

// US-A.1a. qrToken генерує лише сервер (TA-12): 192 біти випадковості, як у seed-demo.ts; у відповідь
// не потрапляє (FB-12). Назва не унікальна: data_model.md §3.2 не вимагає унікальності, а коду помилки
// для дубліката в error_format.md немає — відкрите питання Q09.
export async function createRoom(body: CreateRoomBody): Promise<Room> {
  const record = await prisma.room.create({
    data: {
      name: body.name,
      capacity: body.capacity,
      building: body.building,
      floor: body.floor,
      equipment: JSON.stringify(body.equipment),
      qrToken: randomBytes(24).toString('base64url'),
    },
    select: ROOM_FIELDS,
  });
  return toApiRoom(record);
}

// US-A.1b. Змінюються лише надіслані поля (AC-03), equipment замінюється цілком; qrToken не змінюється
// ніколи (FB-13) — його немає ні в схемі тіла, ні тут.
export async function updateRoom(roomId: string, body: UpdateRoomBody): Promise<Room> {
  const data: Prisma.RoomUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.capacity !== undefined) data.capacity = body.capacity;
  if (body.building !== undefined) data.building = body.building;
  if (body.floor !== undefined) data.floor = body.floor;
  if (body.equipment !== undefined) data.equipment = JSON.stringify(body.equipment);

  try {
    const record = await prisma.room.update({ where: { id: roomId }, data, select: ROOM_FIELDS });
    return toApiRoom(record);
  } catch (err) {
    if (isPrismaError(err, 'P2025')) throw roomNotFound();
    throw err;
  }
}

function slotValidationError(message: string): AppError {
  // reason — код Zod для правил поза схемою (`custom`), як у refine CreateSlotBody (error_format.md §1).
  return new AppError('VALIDATION_ERROR', message, { fields: [{ path: 'endsAt', reason: 'custom' }] });
}

// US-A.2. Правила, що залежать від годинника й поясу, — тут, а не в shared/ (див. CreateSlotBody):
// - [Пропозиція] G7: початок і кінець — та сама дата університету. Кінець рівно о 00:00 наступної дати
//   теж відхиляється: обрано найсуворіший варіант, поки G7 (перетин опівночі) не вирішене;
// - [Пропозиція] Q10: endsAt > now (api_spec.md §9); правило обмежує лише кінець, тож слот, що вже
//   почався, але не завершився, проходить.
// Перетин (BR-13): півінтервали [startsAt, endsAt) — суміжні слоти (10:00–11:00 і 11:00–12:00) не
// перетинаються, як у seed-demo.ts. Суміжність — відкрите G7/Q10.
export async function createSlot(roomId: string, startsAtIso: string, endsAtIso: string): Promise<Slot> {
  const startsAt = new Date(startsAtIso);
  const endsAt = new Date(endsAtIso);

  if (toLocalDate(startsAt) !== toLocalDate(endsAt)) {
    throw slotValidationError('Початок і завершення слота мають бути в одну дату');
  }
  if (endsAt.getTime() <= now().getTime()) {
    throw slotValidationError('Слот уже завершився');
  }

  // Спершу вставка, потім перевірки в тій самій транзакції. Вставка одразу бере блокування запису
  // SQLite, тож паралельні створення виконуються по черзі й наступне бачить попередній слот.
  // Порядок «прочитати → записати» в транзакції під конкуренцією давав SQLITE_BUSY (P1008).
  // Конфлікт кидає помилку всередині транзакції — вставка відкочується.
  try {
    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.slot.create({
        data: { roomId, startsAt, endsAt },
        select: { id: true, roomId: true, startsAt: true, endsAt: true },
      });
      const overlapping = await tx.slot.findFirst({
        where: {
          roomId,
          id: { not: created.id },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        select: { id: true },
      });
      if (overlapping) {
        throw new AppError('SLOT_OVERLAP', 'Слот перетинається з наявним слотом кімнати');
      }
      return created;
    });
    return {
      id: record.id,
      roomId: record.roomId,
      startsAt: record.startsAt.toISOString(),
      endsAt: record.endsAt.toISOString(),
    };
  } catch (err) {
    // Кімнати немає: зовнішній ключ Slot.roomId відхиляє вставку.
    if (isPrismaError(err, 'P2003')) throw roomNotFound();
    throw err;
  }
}

// US-A.4a. Єдине місце, де віддається qrToken (FB-12); токен статичний, тож повтор дає той самий (FB-13).
export async function getRoomQrToken(roomId: string): Promise<QrTokenResponse> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, qrToken: true },
  });
  if (!room) throw roomNotFound();
  return { roomId: room.id, roomName: room.name, qrToken: room.qrToken };
}
