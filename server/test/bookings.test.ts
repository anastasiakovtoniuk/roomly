import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GRACE_PERIOD_MINUTES,
  LIVE_BOOKING_STATUSES,
  SESSION_COOKIE_NAME,
  type AvailableSlotListResponse,
  type BookingResponse,
  type ErrorBody,
  type MeResponse,
} from '@roomly/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { resetClock, setClock } from '../src/lib/clock';

const app = createApp();
const PASSWORD = 'secret-pass';
const HOUR_MS = 60 * 60 * 1000;

// Підмінений «зараз» і слоти відносно нього: завтра за Києвом 10:00–11:00 і 11:00–12:00.
const NOW = new Date('2026-11-02T09:30:00.000Z');
const SLOT_START = '2026-11-03T08:00:00.000Z';
const NEXT_SLOT_START = '2026-11-03T09:00:00.000Z';

// Тестова база спільна для всіх файлів і не очищується: кожен тест створює власну кімнату
// й слоти, а перевірки шукають лише свої записи.
async function createRoom() {
  return prisma.room.create({
    data: {
      name: `Кімната ${randomUUID()}`,
      capacity: 6,
      building: 'Корпус 1',
      floor: 2,
      equipment: JSON.stringify([]),
      qrToken: `qr-${randomUUID()}`,
    },
  });
}

async function createSlot(roomId: string, startsAt: string, hours = 1) {
  const start = new Date(startsAt);
  return prisma.slot.create({
    data: { roomId, startsAt: start, endsAt: new Date(start.getTime() + hours * HOUR_MS) },
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

async function userIdOf(cookie: string): Promise<string> {
  const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
  expect(res.status).toBe(200);
  return (res.body as MeResponse).user.id;
}

function book(cookie: string | null, body: Record<string, unknown>) {
  const req = request(app).post('/api/bookings');
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
}

function errorCode(res: request.Response): string {
  return (res.body as ErrorBody).error.code;
}

function bookingsOfSlot(slotId: string) {
  return prisma.booking.findMany({ where: { slotId } });
}

function liveBookingsOfSlot(slotId: string) {
  return prisma.booking.findMany({ where: { slotId, status: { in: [...LIVE_BOOKING_STATUSES] } } });
}

beforeEach(() => {
  setClock(() => NOW);
});

afterEach(() => {
  resetClock();
});

describe('POST /api/bookings — створення', () => {
  it('US-3.1-AC-01 студент бронює вільний слот одним запитом: 201 з booking і serverTime', async () => {
    const cookie = await studentCookie();
    const room = await createRoom();
    const slot = await createSlot(room.id, SLOT_START);

    const res = await book(cookie, { slotId: slot.id });

    expect(res.status).toBe(201);
    const body = res.body as BookingResponse;
    expect(Object.keys(body).sort()).toEqual(['booking', 'serverTime']);
    expect(body.serverTime).toBe(NOW.toISOString());
    expect(body.booking).toEqual({
      id: expect.any(String) as string,
      status: 'active',
      room: { id: room.id, name: room.name, building: room.building, floor: room.floor },
      slot: { id: slot.id, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() },
      deadline: expect.any(String) as string,
      createdAt: NOW.toISOString(),
      confirmedAt: null,
      confirmedBy: null,
      cancelledAt: null,
    });
  });

  it('US-3.1-AC-02 бронювання active належить користувачу сесії, а не userId з тіла, і має deadline = startsAt + grace period', async () => {
    const cookie = await studentCookie();
    const ownerId = await userIdOf(cookie);
    const otherId = await userIdOf(await studentCookie());
    const room = await createRoom();
    const slot = await createSlot(room.id, SLOT_START);

    const res = await book(cookie, { slotId: slot.id, userId: otherId, status: 'confirmed' });

    expect(res.status).toBe(201);
    const { booking } = res.body as BookingResponse;
    const expectedDeadline = new Date(slot.startsAt.getTime() + GRACE_PERIOD_MINUTES * 60 * 1000);
    expect(booking.status).toBe('active');
    expect(booking.deadline).toBe(expectedDeadline.toISOString());

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.userId).toBe(ownerId);
    expect(stored.slotId).toBe(slot.id);
    expect(stored.status).toBe('active');
    expect(stored.deadline.toISOString()).toBe(expectedDeadline.toISOString());
  });

  it('US-3.1-AC-03 після бронювання слот недоступний іншим: 409 і його немає серед вільних', async () => {
    const room = await createRoom();
    const slot = await createSlot(room.id, SLOT_START);
    expect((await book(await studentCookie(), { slotId: slot.id })).status).toBe(201);

    const other = await studentCookie();
    const res = await book(other, { slotId: slot.id });

    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('SLOT_ALREADY_BOOKED');
    const available = await request(app)
      .get(`/api/rooms/${room.id}/available-slots`)
      .query({ date: '2026-11-03' })
      .set('Cookie', other);
    expect((available.body as AvailableSlotListResponse).slots.map((s) => s.id)).not.toContain(slot.id);
  });

  it('US-3.1-AC-04 гість отримує 401 UNAUTHENTICATED, бронювання не створюється', async () => {
    const room = await createRoom();
    const slot = await createSlot(room.id, SLOT_START);

    const res = await book(null, { slotId: slot.id });

    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHENTICATED');
    expect(await bookingsOfSlot(slot.id)).toHaveLength(0);
  });

  it('адміністратор отримує 403 FORBIDDEN, бронювання не створюється', async () => {
    const room = await createRoom();
    const slot = await createSlot(room.id, SLOT_START);

    const res = await book(await adminCookie(), { slotId: slot.id });

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(await bookingsOfSlot(slot.id)).toHaveLength(0);
  });
});

describe('POST /api/bookings — зайнятий слот', () => {
  it('US-3.4-AC-01 спроба забронювати зайнятий слот дає 409 SLOT_ALREADY_BOOKED без другого запису', async () => {
    const room = await createRoom();
    const slot = await createSlot(room.id, SLOT_START);
    expect((await book(await studentCookie(), { slotId: slot.id })).status).toBe(201);

    const res = await book(await studentCookie(), { slotId: slot.id });

    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('SLOT_ALREADY_BOOKED');
    expect(await bookingsOfSlot(slot.id)).toHaveLength(1);
  });

  it('US-3.4-AC-02 після відмови через зайнятість студент бронює інший вільний слот', async () => {
    const room = await createRoom();
    const taken = await createSlot(room.id, SLOT_START);
    const free = await createSlot(room.id, NEXT_SLOT_START);
    expect((await book(await studentCookie(), { slotId: taken.id })).status).toBe(201);
    const cookie = await studentCookie();
    expect((await book(cookie, { slotId: taken.id })).status).toBe(409);

    const res = await book(cookie, { slotId: free.id });

    expect(res.status).toBe(201);
    expect((res.body as BookingResponse).booking.slot.id).toBe(free.id);
  });

  it('US-3.4-AC-03 SYS-AC-06 два одночасні запити на один слот: один 201, другий 409, у БД один живий запис', async () => {
    const room = await createRoom();
    const slot = await createSlot(room.id, SLOT_START);
    const [first, second] = [await studentCookie(), await studentCookie()];

    const responses = await Promise.all([
      book(first, { slotId: slot.id }),
      book(second, { slotId: slot.id }),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const rejected = responses.find((r) => r.status === 409);
    expect(rejected && errorCode(rejected)).toBe('SLOT_ALREADY_BOOKED');
    expect(await liveBookingsOfSlot(slot.id)).toHaveLength(1);
    expect(await bookingsOfSlot(slot.id)).toHaveLength(1);
  });

  it('SYS-AC-06 скасоване бронювання не утримує слот: новий живий запис створюється', async () => {
    const room = await createRoom();
    const slot = await createSlot(room.id, SLOT_START);
    const res1 = await book(await studentCookie(), { slotId: slot.id });
    expect(res1.status).toBe(201);
    await prisma.booking.update({
      where: { id: (res1.body as BookingResponse).booking.id },
      data: { status: 'cancelled_by_student', cancelledAt: NOW },
    });

    const res2 = await book(await studentCookie(), { slotId: slot.id });

    expect(res2.status).toBe(201);
    expect(await liveBookingsOfSlot(slot.id)).toHaveLength(1);
    expect(await bookingsOfSlot(slot.id)).toHaveLength(2);
  });
});

describe('POST /api/bookings — недоступний слот і валідація', () => {
  it('невідомий слот — 404 SLOT_NOT_FOUND', async () => {
    const res = await book(await studentCookie(), { slotId: randomUUID() });

    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('SLOT_NOT_FOUND');
  });

  it('G1 варіант «а»: слот, що починається саме зараз, — 409 SLOT_NOT_BOOKABLE', async () => {
    const room = await createRoom();
    const slot = await createSlot(room.id, SLOT_START);
    setClock(() => new Date(SLOT_START));

    const res = await book(await studentCookie(), { slotId: slot.id });

    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('SLOT_NOT_BOOKABLE');
    expect(await bookingsOfSlot(slot.id)).toHaveLength(0);
  });

  it('G1 варіант «а»: слот, що вже почався, — 409 SLOT_NOT_BOOKABLE', async () => {
    const room = await createRoom();
    const slot = await createSlot(room.id, SLOT_START);
    setClock(() => new Date('2026-11-03T08:30:00.000Z'));

    const res = await book(await studentCookie(), { slotId: slot.id });

    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('SLOT_NOT_BOOKABLE');
    expect(await bookingsOfSlot(slot.id)).toHaveLength(0);
  });

  it('BR-11 слот, що завершився, — 409 SLOT_NOT_BOOKABLE', async () => {
    const room = await createRoom();
    const slot = await createSlot(room.id, SLOT_START);
    setClock(() => new Date('2026-11-03T10:00:00.000Z'));

    const res = await book(await studentCookie(), { slotId: slot.id });

    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('SLOT_NOT_BOOKABLE');
    expect(await bookingsOfSlot(slot.id)).toHaveLength(0);
  });

  it('slotId не UUID або відсутній — 400 VALIDATION_ERROR', async () => {
    const cookie = await studentCookie();

    for (const body of [{ slotId: 'not-a-uuid' }, {}]) {
      const res = await book(cookie, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(errorCode(res), JSON.stringify(body)).toBe('VALIDATION_ERROR');
    }
  });
});
