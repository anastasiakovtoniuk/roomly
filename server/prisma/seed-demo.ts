// Необов'язковий демо-seed (data_model.md §8, issue #9): кімнати й слоти для ручної перевірки сценарію.
// Запускається окремою командою `npm run db:seed:demo -w server`, а не з `npm run dev`.
// Слоти рахуються відносно моменту запуску, інакше вони застаріють. Користувачів і бронювань
// не створює: студент реєструється сам (booking_flow.md §4), адміністратора створює seed.ts.
// Нічого не видаляє й не змінює: повторний запуск лише додає те, чого бракує.
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { prisma } from '../src/db/prisma';
import { now } from '../src/lib/clock';
import { localDateTimeToUtc, toLocalDate } from '../src/lib/localDate';

export interface DemoRoom {
  name: string;
  capacity: number;
  building: string;
  floor: number;
  equipment: string[];
}

// Різні корпуси, поверхи, місткість і обладнання; одна кімната без обладнання (US-2.2-AC-02).
export const DEMO_ROOMS: readonly DemoRoom[] = [
  { name: 'R101', capacity: 4, building: 'Корпус 1', floor: 1, equipment: ['Дошка', 'Телевізор'] },
  { name: 'R205', capacity: 6, building: 'Корпус 1', floor: 2, equipment: ['Проєктор', 'Дошка'] },
  {
    name: 'Бібліотека 3.1',
    capacity: 8,
    building: 'Бібліотека',
    floor: 3,
    equipment: ['Проєктор', 'Відеоконференція'],
  },
  { name: 'Тиха кімната', capacity: 2, building: 'Бібліотека', floor: 1, equipment: [] },
];

// Години початку за часовим поясом університету (APP_TIMEZONE); перерва о 12:00.
export const DEMO_SLOT_HOURS: readonly number[] = [9, 10, 11, 13, 14, 15, 16, 17];
export const DEMO_DAYS_AHEAD = 3;
const SLOT_DURATION_MS = 60 * 60 * 1000;

export interface SeedDemoResult {
  roomsCreated: number;
  roomsExisting: number;
  slotsCreated: number;
  slotsSkipped: number;
}

// Дата `YYYY-MM-DD` через `days` календарних днів; лише арифметика дати, без часового поясу.
function addDays(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

// Кімнату шукаємо за назвою: name не унікальне в схемі (Q09), але скрипт локальний і одноразовий,
// тож пошук достатній для ідемпотентності. Наявну кімнату (і її qrToken) не змінюємо.
async function ensureRoom(room: DemoRoom): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.room.findFirst({ where: { name: room.name }, select: { id: true } });
  if (existing) {
    return { id: existing.id, created: false };
  }
  const created = await prisma.room.create({
    data: {
      name: room.name,
      capacity: room.capacity,
      building: room.building,
      floor: room.floor,
      equipment: JSON.stringify(room.equipment),
      // Унікальний (TA-12) і невгадуваний токен; у вивід скрипта не потрапляє (FB-12).
      qrToken: randomBytes(24).toString('base64url'),
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

// `rooms` — лише для тестів: спільна тестова база містить кімнати інших файлів тестів з тими самими
// назвами (наприклад, R101), тож тест передає власні унікальні назви. Скрипт завжди бере DEMO_ROOMS.
export async function seedDemo(rooms: readonly DemoRoom[] = DEMO_ROOMS): Promise<SeedDemoResult> {
  const startedAt = now();
  const today = toLocalDate(startedAt);
  const result: SeedDemoResult = { roomsCreated: 0, roomsExisting: 0, slotsCreated: 0, slotsSkipped: 0 };

  // Однакові для всіх кімнат проміжки: лише години, що ще не настали — розпочатий слот однаково
  // не бронюється (G1/Q04 «а»).
  const candidates: { startsAt: Date; endsAt: Date }[] = [];
  for (let day = 0; day <= DEMO_DAYS_AHEAD; day += 1) {
    const date = addDays(today, day);
    for (const hour of DEMO_SLOT_HOURS) {
      const startsAt = localDateTimeToUtc(date, hour);
      if (startsAt.getTime() > startedAt.getTime()) {
        candidates.push({ startsAt, endsAt: new Date(startsAt.getTime() + SLOT_DURATION_MS) });
      }
    }
  }
  const first = candidates[0];
  const last = candidates[candidates.length - 1];

  for (const demoRoom of rooms) {
    const room = await ensureRoom(demoRoom);
    if (room.created) result.roomsCreated += 1;
    else result.roomsExisting += 1;
    if (!first || !last) continue;

    // Слоти кімнати, що зачіпають увесь проміжок демо-seed, — одним запитом, а не запитом на кожен
    // слот: так seed не тримає SQLite сотнями дрібних запитів.
    const existing = await prisma.slot.findMany({
      where: { roomId: room.id, startsAt: { lt: last.endsAt }, endsAt: { gt: first.startsAt } },
      select: { startsAt: true, endsAt: true },
    });
    // Перетин із будь-яким слотом кімнати (BR-13) — і повторний запуск, і слот, створений вручну.
    const free = candidates.filter(
      (slot) => !existing.some((other) => slot.startsAt < other.endsAt && other.startsAt < slot.endsAt),
    );
    result.slotsSkipped += candidates.length - free.length;
    if (free.length > 0) {
      await prisma.slot.createMany({ data: free.map((slot) => ({ roomId: room.id, ...slot })) });
      result.slotsCreated += free.length;
    }
  }

  return result;
}

async function main() {
  const result = await seedDemo();
  console.log(
    `Демо-seed: кімнат створено ${result.roomsCreated}, уже було ${result.roomsExisting}; ` +
      `слотів створено ${result.slotsCreated}, пропущено ${result.slotsSkipped} (уже є або перетинаються).`,
  );
}

// Запуск лише як скрипта; тести імпортують seedDemo без побічних дій.
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main()
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
