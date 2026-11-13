import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_ROOMS, DEMO_SLOT_HOURS, DEMO_DAYS_AHEAD, seedDemo } from '../prisma/seed-demo';
import { prisma } from '../src/db/prisma';
import { resetClock, setClock } from '../src/lib/clock';
import { localDateTimeToUtc, toLocalDate } from '../src/lib/localDate';

afterEach(() => {
  resetClock();
});

describe('localDateTimeToUtc', () => {
  it('година за Києвом узимку (UTC+2) і влітку (UTC+3)', () => {
    expect(localDateTimeToUtc('2026-11-03', 9).toISOString()).toBe('2026-11-03T07:00:00.000Z');
    expect(localDateTimeToUtc('2026-07-01', 9).toISOString()).toBe('2026-07-01T06:00:00.000Z');
  });

  it('дати переходу на літній і зимовий час', () => {
    // 28.03.2027 о 03:00 годинник переводять на 04:00; 25.10.2026 о 04:00 — на 03:00.
    expect(localDateTimeToUtc('2027-03-27', 9).toISOString()).toBe('2027-03-27T07:00:00.000Z');
    expect(localDateTimeToUtc('2027-03-28', 9).toISOString()).toBe('2027-03-28T06:00:00.000Z');
    expect(localDateTimeToUtc('2026-10-24', 9).toISOString()).toBe('2026-10-24T06:00:00.000Z');
    expect(localDateTimeToUtc('2026-10-25', 9).toISOString()).toBe('2026-10-25T07:00:00.000Z');
  });

  it('зворотне до toLocalDate: опівночі за Києвом — ще та сама дата', () => {
    const midnight = localDateTimeToUtc('2026-11-04', 0);
    expect(midnight.toISOString()).toBe('2026-11-03T22:00:00.000Z');
    expect(toLocalDate(midnight)).toBe('2026-11-04');
  });
});

// Тести цього блоку йдуть послідовно й спираються на дані попереднього: демо-кімнати мають
// фіксовані назви, а тестова база створюється з міграцій один раз на запуск (globalSetup).
describe('демо-seed (data_model.md §8, issue #9)', () => {
  // 12:30 за Києвом: на сьогодні лишаються слоти з 13:00.
  const NOW = new Date('2026-11-02T10:30:00.000Z');
  const DEMO_DATES = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];

  function demoRoomIds() {
    return prisma.room
      .findMany({ where: { name: { in: DEMO_ROOMS.map((r) => r.name) } }, select: { id: true } })
      .then((rooms) => rooms.map((r) => r.id));
  }

  it('створює кімнати з різними корпусами, поверхами, місткістю й обладнанням і слоти лише в майбутньому', async () => {
    setClock(() => NOW);

    const result = await seedDemo();

    expect(result.roomsCreated).toBe(DEMO_ROOMS.length);
    expect(result.roomsExisting).toBe(0);
    expect(DEMO_ROOMS.length).toBeGreaterThanOrEqual(3);
    expect(DEMO_ROOMS.length).toBeLessThanOrEqual(4);

    const rooms = await prisma.room.findMany({ where: { name: { in: DEMO_ROOMS.map((r) => r.name) } } });
    expect(rooms).toHaveLength(DEMO_ROOMS.length);
    expect(new Set(rooms.map((r) => r.building)).size).toBeGreaterThan(1);
    expect(new Set(rooms.map((r) => r.floor)).size).toBeGreaterThan(1);
    expect(new Set(rooms.map((r) => r.capacity)).size).toBeGreaterThan(1);
    expect(new Set(rooms.map((r) => r.qrToken)).size).toBe(rooms.length);
    const equipment = rooms.map((r) => JSON.parse(r.equipment) as unknown);
    expect(equipment.every((e) => Array.isArray(e) && e.every((item) => typeof item === 'string'))).toBe(
      true,
    );

    const slots = await prisma.slot.findMany({ where: { roomId: { in: rooms.map((r) => r.id) } } });
    // Сьогодні — лише 13:00…17:00 (5 слотів), далі DEMO_DAYS_AHEAD повних днів.
    const todayLeft = DEMO_SLOT_HOURS.filter((h) => h >= 13).length;
    const perRoom = todayLeft + DEMO_DAYS_AHEAD * DEMO_SLOT_HOURS.length;
    expect(result.slotsCreated).toBe(perRoom * rooms.length);
    expect(slots).toHaveLength(perRoom * rooms.length);
    expect(slots.every((s) => s.startsAt.getTime() > NOW.getTime())).toBe(true);
    expect(slots.every((s) => s.endsAt.getTime() - s.startsAt.getTime() === 60 * 60 * 1000)).toBe(true);
    expect(new Set(slots.map((s) => toLocalDate(s.startsAt)))).toEqual(new Set(DEMO_DATES));

    // Бронювань демо-seed не створює. Загальні лічильники користувачів і бронювань тут не годяться:
    // інші файли тестів паралельно пишуть у ту саму тестову базу. Користувачів seedDemo не торкається
    // зовсім — він працює лише з таблицями Room і Slot.
    expect(await prisma.booking.count({ where: { slot: { roomId: { in: rooms.map((r) => r.id) } } } })).toBe(
      0,
    );
  });

  it('повторний запуск нічого не дублює', async () => {
    setClock(() => NOW);
    const roomIds = await demoRoomIds();
    const slotsBefore = await prisma.slot.count({ where: { roomId: { in: roomIds } } });

    const result = await seedDemo();

    expect(result).toMatchObject({ roomsCreated: 0, roomsExisting: DEMO_ROOMS.length, slotsCreated: 0 });
    expect(await demoRoomIds()).toHaveLength(DEMO_ROOMS.length);
    expect(await prisma.slot.count({ where: { roomId: { in: roomIds } } })).toBe(slotsBefore);
  });

  it('наступного дня додає слоти нової дати, але пропускає ті, що перетинаються з наявним слотом кімнати', async () => {
    const room = await prisma.room.findFirstOrThrow({ where: { name: DEMO_ROOMS[0]?.name } });
    // Слот, створений «вручну»: 09:30–10:30 за Києвом 06.11 перетинає демо-слоти 09:00 і 10:00.
    await prisma.slot.create({
      data: {
        roomId: room.id,
        startsAt: new Date('2026-11-06T07:30:00.000Z'),
        endsAt: new Date('2026-11-06T08:30:00.000Z'),
      },
    });
    setClock(() => new Date(NOW.getTime() + 24 * 60 * 60 * 1000));

    const result = await seedDemo();

    expect(result.roomsCreated).toBe(0);
    // Нова дата 06.11: повний день у кожній кімнаті, крім двох слотів, що перетинаються.
    expect(result.slotsCreated).toBe(DEMO_SLOT_HOURS.length * DEMO_ROOMS.length - 2);
    const onNewDate = await prisma.slot.findMany({
      where: { roomId: room.id, startsAt: { gte: new Date('2026-11-05T22:00:00.000Z') } },
      orderBy: { startsAt: 'asc' },
    });
    expect(onNewDate.map((s) => s.startsAt.toISOString())).not.toContain('2026-11-06T07:00:00.000Z');
    expect(onNewDate.map((s) => s.startsAt.toISOString())).not.toContain('2026-11-06T08:00:00.000Z');
    expect(onNewDate).toHaveLength(DEMO_SLOT_HOURS.length - 2 + 1);
  });
});
