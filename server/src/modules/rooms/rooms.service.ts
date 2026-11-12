import {
  LIVE_BOOKING_STATUSES,
  type AvailableSlot,
  type AvailableSlotListResponse,
  type Room,
} from '@roomly/shared';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/appError';
import { now } from '../../lib/clock';
import { toLocalDate, utcRangeCovering } from '../../lib/localDate';

interface RoomRecord {
  id: string;
  name: string;
  capacity: number;
  building: string;
  floor: number;
  equipment: string;
}

// qrToken навмисно не вибирається з бази: його немає в Room ні для кого (FB-12).
const ROOM_FIELDS = {
  id: true,
  name: true,
  capacity: true,
  building: true,
  floor: true,
  equipment: true,
} as const;

// equipment зберігається JSON-масивом рядків (data_model.md §3.2). Зіпсоване значення —
// помилка даних, а не порожній перелік: інакше студент побачив би кімнату без обладнання (US-2.2-AC-01).
function parseEquipment(record: RoomRecord): string[] {
  const value: unknown = JSON.parse(record.equipment);
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Некоректне обладнання кімнати ${record.id}`);
  }
  return value;
}

function toApiRoom(record: RoomRecord): Room {
  return {
    id: record.id,
    name: record.name,
    capacity: record.capacity,
    building: record.building,
    floor: record.floor,
    equipment: parseEquipment(record),
  };
}

// US-1.3, US-2.1…2.3: усі кімнати за назвою ([Пропозиція] api_spec.md §6), без фільтрів (FB-15).
export async function listRooms(): Promise<Room[]> {
  const records = await prisma.room.findMany({ select: ROOM_FIELDS, orderBy: { name: 'asc' } });
  return records.map(toApiRoom);
}

export async function getRoom(roomId: string): Promise<Room> {
  const record = await prisma.room.findUnique({ where: { id: roomId }, select: ROOM_FIELDS });
  if (!record) {
    throw new AppError('ROOM_NOT_FOUND', 'Кімнату не знайдено');
  }
  return toApiRoom(record);
}

// US-2.4: вільні слоти кімнати, що починаються в дату університету `date`.
// Вільний (TA-11, BR-11, data_model.md §5): немає бронювання active/confirmed і слот ще не почався —
// G1/Q04 варіант «а», рішення сценарію booking_flow.md; той самий варіант забороняє бронювати
// розпочатий слот (SLOT_NOT_BOOKABLE), тож список і бронювання узгоджені.
// Ліниве автоскасування (BR-5, ADR-0006) тут не викликається: у сценарії booking_flow.md воно вимкнене.
export async function listAvailableSlots(roomId: string, date: string): Promise<AvailableSlotListResponse> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
  if (!room) {
    throw new AppError('ROOM_NOT_FOUND', 'Кімнату не знайдено');
  }

  const serverTime = now();
  const { from, to } = utcRangeCovering(date);
  const records = await prisma.slot.findMany({
    where: {
      roomId,
      startsAt: { gte: from, lt: to, gt: serverTime },
      bookings: { none: { status: { in: [...LIVE_BOOKING_STATUSES] } } },
    },
    select: { id: true, roomId: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: 'asc' },
  });

  const slots: AvailableSlot[] = records
    .filter((slot) => toLocalDate(slot.startsAt) === date)
    .map((slot) => ({
      id: slot.id,
      roomId: slot.roomId,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      // US-2.6 поза сценарієм booking_flow.md: автоскасування вимкнене, тож автоскасованих
      // бронювань не буває і позначка завжди false. Справжня перевірка з'явиться разом з US-2.6.
      releasedByAutoCancel: false,
    }));

  return { roomId, date, serverTime: serverTime.toISOString(), slots };
}
