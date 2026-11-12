import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  type AvailableSlotListResponse,
  type BookingStatus,
  type ErrorBody,
  type Room,
  type RoomListResponse,
} from '@roomly/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { resetClock, setClock } from '../src/lib/clock';

const app = createApp();
const PASSWORD = 'secret-pass';

// Демо-даних (#9) ще немає, тому кожен тест сам створює кімнати, слоти й бронювання.
// Тестова база спільна для всіх файлів і не очищується: назви й токени унікальні,
// а перевірки шукають лише свої записи.
interface RoomInput {
  name?: string;
  capacity?: number;
  building?: string;
  floor?: number;
  equipment?: string[];
}

async function createRoom(input: RoomInput = {}) {
  return prisma.room.create({
    data: {
      name: input.name ?? `Кімната ${randomUUID()}`,
      capacity: input.capacity ?? 6,
      building: input.building ?? 'Корпус 1',
      floor: input.floor ?? 1,
      equipment: JSON.stringify(input.equipment ?? []),
      qrToken: `qr-${randomUUID()}`,
    },
  });
}

const HOUR_MS = 60 * 60 * 1000;

async function createSlot(roomId: string, startsAt: string, hours = 1) {
  const start = new Date(startsAt);
  return prisma.slot.create({
    data: { roomId, startsAt: start, endsAt: new Date(start.getTime() + hours * HOUR_MS) },
  });
}

async function createBooking(slotId: string, status: BookingStatus) {
  const user = await prisma.user.create({
    data: { name: 'Власник', email: `owner-${randomUUID()}@example.com`, passwordHash: 'not-used' },
  });
  const slot = await prisma.slot.findUniqueOrThrow({ where: { id: slotId } });
  return prisma.booking.create({
    data: {
      userId: user.id,
      slotId,
      status,
      deadline: new Date(slot.startsAt.getTime() + 15 * 60 * 1000),
      cancelledAt: status === 'cancelled_by_student' ? new Date() : null,
    },
  });
}

function sessionCookieFrom(res: request.Response): string {
  const header = res.headers['set-cookie'] as string[] | string | undefined;
  const cookies = header === undefined ? [] : Array.isArray(header) ? header : [header];
  const cookie = cookies.find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!cookie) throw new Error('Відповідь не встановила cookie сесії');
  return cookie.split(';', 1).join('');
}

async function studentCookie(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Олена', email: `student-${randomUUID()}@example.com`, password: PASSWORD });
  expect(res.status).toBe(201);
  return sessionCookieFrom(res);
}

async function adminCookie(): Promise<string> {
  const email = `admin-${randomUUID()}@example.com`;
  await prisma.user.create({
    data: { name: 'Адмін', email, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'admin' },
  });
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return sessionCookieFrom(res);
}

function errorCode(res: request.Response): string {
  return (res.body as ErrorBody).error.code;
}

function availableSlots(cookie: string, roomId: string, date: string) {
  return request(app).get(`/api/rooms/${roomId}/available-slots`).query({ date }).set('Cookie', cookie);
}

let cookie: string;

beforeAll(async () => {
  cookie = await studentCookie();
});

afterEach(() => {
  resetClock();
});

describe('доступ до каталогу', () => {
  it('гість отримує 401 UNAUTHENTICATED на всіх ендпоінтах кімнат', async () => {
    const room = await createRoom();

    for (const path of [
      '/api/rooms',
      `/api/rooms/${room.id}`,
      `/api/rooms/${room.id}/available-slots?date=2026-11-03`,
    ]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
      expect(errorCode(res), path).toBe('UNAUTHENTICATED');
    }
  });

  it('адміністратор як авторизований користувач теж бачить кімнати й слоти', async () => {
    const admin = await adminCookie();
    const room = await createRoom();

    expect((await request(app).get('/api/rooms').set('Cookie', admin)).status).toBe(200);
    expect((await request(app).get(`/api/rooms/${room.id}`).set('Cookie', admin)).status).toBe(200);
    expect((await availableSlots(admin, room.id, '2026-11-03')).status).toBe(200);
  });
});

describe('GET /api/rooms', () => {
  it('US-1.3-AC-01 одразу після входу студент отримує список кімнат тією ж сесією', async () => {
    const room = await createRoom();
    const freshCookie = await studentCookie();

    const res = await request(app).get('/api/rooms').set('Cookie', freshCookie);

    expect(res.status).toBe(200);
    expect((res.body as RoomListResponse).rooms.map((r) => r.id)).toContain(room.id);
  });

  it('US-1.3-AC-02 список містить лише збережені кімнати, без вигаданих записів', async () => {
    await createRoom();
    const before = new Set((await prisma.room.findMany({ select: { id: true } })).map((r) => r.id));

    const res = await request(app).get('/api/rooms').set('Cookie', cookie);

    // Інші файли тестів можуть паралельно додати кімнату, тому відповідь порівнюється
    // з базою до й після запиту: нічого з наявного не загублено і нічого не вигадано.
    const after = new Set((await prisma.room.findMany({ select: { id: true } })).map((r) => r.id));
    const ids = (res.body as RoomListResponse).rooms.map((r) => r.id);
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as RoomListResponse).rooms)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of before) expect(ids).toContain(id);
    for (const id of ids) expect(after.has(id)).toBe(true);
  });

  it('US-2.1-AC-01 US-2.1-AC-02 кожна кімната має власну збережену місткість', async () => {
    const small = await createRoom({ capacity: 4 });
    const large = await createRoom({ capacity: 12 });

    const res = await request(app).get('/api/rooms').set('Cookie', cookie);

    const rooms = (res.body as RoomListResponse).rooms;
    expect(rooms.find((r) => r.id === small.id)?.capacity).toBe(4);
    expect(rooms.find((r) => r.id === large.id)?.capacity).toBe(12);
  });

  it('US-2.2-AC-01 US-2.2-AC-02 обладнання — збережений масив рядків, відсутнє не показується', async () => {
    const full = await createRoom({ equipment: ['екран', 'дошка'] });
    const noBoard = await createRoom({ equipment: ['екран'] });
    const empty = await createRoom({ equipment: [] });

    const res = await request(app).get('/api/rooms').set('Cookie', cookie);

    const rooms = (res.body as RoomListResponse).rooms;
    expect(rooms.find((r) => r.id === full.id)?.equipment).toEqual(['екран', 'дошка']);
    expect(rooms.find((r) => r.id === noBoard.id)?.equipment).toEqual(['екран']);
    expect(rooms.find((r) => r.id === empty.id)?.equipment).toEqual([]);
  });

  it('US-2.3-AC-01 US-2.3-AC-02 кімнати одного корпусу показують власні поверхи', async () => {
    const building = `Корпус ${randomUUID()}`;
    const second = await createRoom({ building, floor: 2 });
    const fourth = await createRoom({ building, floor: 4 });

    const res = await request(app).get('/api/rooms').set('Cookie', cookie);

    const rooms = (res.body as RoomListResponse).rooms;
    expect(rooms.find((r) => r.id === second.id)).toMatchObject({ building, floor: 2 });
    expect(rooms.find((r) => r.id === fourth.id)).toMatchObject({ building, floor: 4 });
  });

  it('кімнати впорядковані за name українською абеткою, без різниці регістру, числа — за значенням', async () => {
    const prefix = `Сорт ${randomUUID()}`;
    // Створюються не за порядком; у байтовому порівнянні SQLite «Їжак» і «яблуня» стояли б інакше.
    const names = ['яблуня', 'Зала 10', 'Їжак', 'береза', 'Зала 9', 'Айва'];
    const created = new Map<string, string>();
    for (const name of names) created.set((await createRoom({ name: `${prefix} ${name}` })).id, name);

    const res = await request(app).get('/api/rooms').set('Cookie', cookie);

    const order = (res.body as RoomListResponse).rooms
      .filter((r) => created.has(r.id))
      .map((r) => created.get(r.id));
    expect(order).toEqual(['Айва', 'береза', 'Зала 9', 'Зала 10', 'Їжак', 'яблуня']);
  });

  it('FB-12 відповідь не містить qrToken і має лише поля Room', async () => {
    const room = await createRoom({
      name: 'R101',
      capacity: 6,
      building: 'Корпус 1',
      floor: 2,
      equipment: ['екран'],
    });

    const res = await request(app).get('/api/rooms').set('Cookie', cookie);

    expect(res.text).not.toContain(room.qrToken);
    expect((res.body as RoomListResponse).rooms.find((r) => r.id === room.id)).toStrictEqual({
      id: room.id,
      name: 'R101',
      capacity: 6,
      building: 'Корпус 1',
      floor: 2,
      equipment: ['екран'],
    } satisfies Room);
  });
});

describe('GET /api/rooms/:roomId', () => {
  it('US-2.1-AC-01 US-2.2-AC-01 US-2.3-AC-01 повертає збережені дані кімнати без qrToken', async () => {
    const room = await createRoom({ capacity: 8, building: 'Корпус 3', floor: 5, equipment: ['дошка'] });

    const res = await request(app).get(`/api/rooms/${room.id}`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(room.qrToken);
    expect(res.body).toStrictEqual({
      room: {
        id: room.id,
        name: room.name,
        capacity: 8,
        building: 'Корпус 3',
        floor: 5,
        equipment: ['дошка'],
      },
    });
  });

  it('невідома кімната — 404 ROOM_NOT_FOUND', async () => {
    const res = await request(app).get(`/api/rooms/${randomUUID()}`).set('Cookie', cookie);

    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('ROOM_NOT_FOUND');
  });

  it('roomId не UUID — 400 VALIDATION_ERROR', async () => {
    const res = await request(app).get('/api/rooms/not-a-uuid').set('Cookie', cookie);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: { fields: [{ path: 'params.roomId' }] } },
    });
  });
});

describe('GET /api/rooms/:roomId/available-slots', () => {
  // Листопад — зимовий час Києва, UTC+2. Поточний момент — 2026-11-02 14:00 за Києвом.
  const NOW = new Date('2026-11-02T12:00:00.000Z');

  it('US-2.4-AC-01 повертає слоти, що починаються саме в цю дату за Києвом, упорядковані за startsAt', async () => {
    setClock(() => NOW);
    const room = await createRoom();
    const afternoon = await createSlot(room.id, '2026-11-03T10:00:00.000Z');
    // 00:30 3 листопада за Києвом, хоча в UTC це ще 2 листопада.
    const afterMidnight = await createSlot(room.id, '2026-11-02T22:30:00.000Z');
    // 23:30 2 листопада за Києвом — інша дата.
    await createSlot(room.id, '2026-11-02T21:30:00.000Z', 0.5);
    // 00:30 4 листопада за Києвом — інша дата, хоча в UTC це ще 3 листопада.
    const nextDay = await createSlot(room.id, '2026-11-03T22:30:00.000Z');

    const res = await availableSlots(cookie, room.id, '2026-11-03');

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      roomId: room.id,
      date: '2026-11-03',
      serverTime: NOW.toISOString(),
      slots: [
        {
          id: afterMidnight.id,
          roomId: room.id,
          startsAt: '2026-11-02T22:30:00.000Z',
          endsAt: '2026-11-02T23:30:00.000Z',
          releasedByAutoCancel: false,
        },
        {
          id: afternoon.id,
          roomId: room.id,
          startsAt: '2026-11-03T10:00:00.000Z',
          endsAt: '2026-11-03T11:00:00.000Z',
          releasedByAutoCancel: false,
        },
      ],
    } satisfies AvailableSlotListResponse);

    const next = await availableSlots(cookie, room.id, '2026-11-04');
    expect((next.body as AvailableSlotListResponse).slots.map((s) => s.id)).toEqual([nextDay.id]);
  });

  it('US-2.4-AC-01 межа доби рахується й у літній час (UTC+3)', async () => {
    setClock(() => new Date('2026-07-01T00:00:00.000Z'));
    const room = await createRoom();
    // 00:00 15 липня за Києвом.
    const midnight = await createSlot(room.id, '2026-07-14T21:00:00.000Z');
    // 23:00 14 липня за Києвом.
    await createSlot(room.id, '2026-07-14T20:00:00.000Z');

    const res = await availableSlots(cookie, room.id, '2026-07-15');

    expect((res.body as AvailableSlotListResponse).slots.map((s) => s.id)).toEqual([midnight.id]);
  });

  it('US-2.4-AC-02 слот із бронюванням active чи confirmed не повертається', async () => {
    setClock(() => NOW);
    const room = await createRoom();
    const free = await createSlot(room.id, '2026-11-03T08:00:00.000Z');
    const active = await createSlot(room.id, '2026-11-03T09:00:00.000Z');
    const confirmed = await createSlot(room.id, '2026-11-03T10:00:00.000Z');
    await createBooking(active.id, 'active');
    await createBooking(confirmed.id, 'confirmed');

    const res = await availableSlots(cookie, room.id, '2026-11-03');

    expect((res.body as AvailableSlotListResponse).slots.map((s) => s.id)).toEqual([free.id]);
  });

  it('SYS-AC-10 слот, скасований студентом, знову вільний, а після нового бронювання — ні', async () => {
    setClock(() => NOW);
    const room = await createRoom();
    const slot = await createSlot(room.id, '2026-11-03T08:00:00.000Z');
    await createBooking(slot.id, 'cancelled_by_student');

    const freed = await availableSlots(cookie, room.id, '2026-11-03');
    expect((freed.body as AvailableSlotListResponse).slots.map((s) => s.id)).toEqual([slot.id]);

    await createBooking(slot.id, 'active');

    const rebooked = await availableSlots(cookie, room.id, '2026-11-03');
    expect((rebooked.body as AvailableSlotListResponse).slots).toEqual([]);
  });

  it('G1 варіант «а»: слот, що вже почався або завершився, не повертається', async () => {
    const room = await createRoom();
    const ended = await createSlot(room.id, '2026-11-03T07:00:00.000Z');
    const running = await createSlot(room.id, '2026-11-03T08:00:00.000Z');
    const upcoming = await createSlot(room.id, '2026-11-03T09:00:00.000Z');
    setClock(() => new Date('2026-11-03T08:30:00.000Z'));

    const res = await availableSlots(cookie, room.id, '2026-11-03');

    const ids = (res.body as AvailableSlotListResponse).slots.map((s) => s.id);
    expect(ids).toEqual([upcoming.id]);
    expect(ids).not.toContain(ended.id);
    expect(ids).not.toContain(running.id);
  });

  it('US-2.4-AC-03 дата без вільних слотів — 200 і порожній список', async () => {
    setClock(() => NOW);
    const room = await createRoom();
    const booked = await createSlot(room.id, '2026-11-03T08:00:00.000Z');
    await createBooking(booked.id, 'active');

    const res = await availableSlots(cookie, room.id, '2026-11-03');

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      roomId: room.id,
      date: '2026-11-03',
      serverTime: NOW.toISOString(),
      slots: [],
    });
  });

  it('невідома кімната — 404 ROOM_NOT_FOUND', async () => {
    const res = await availableSlots(cookie, randomUUID(), '2026-11-03');

    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('ROOM_NOT_FOUND');
  });

  it.each([
    ['відсутня дата', undefined],
    ['неіснуюча календарна дата', '2026-02-30'],
    ['інший формат', '03.11.2026'],
    ['дата з часом', '2026-11-03T00:00:00Z'],
  ])('некоректна дата (%s) — 400 VALIDATION_ERROR з полем query.date', async (_label, date) => {
    const room = await createRoom();

    const req = request(app).get(`/api/rooms/${room.id}/available-slots`).set('Cookie', cookie);
    const res = await (date === undefined ? req : req.query({ date }));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: { fields: [{ path: 'query.date' }] } },
    });
  });

  it('roomId не UUID — 400 VALIDATION_ERROR', async () => {
    const res = await availableSlots(cookie, 'not-a-uuid', '2026-11-03');

    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
  });
});
