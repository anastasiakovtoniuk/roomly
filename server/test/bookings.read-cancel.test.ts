import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GRACE_PERIOD_MINUTES,
  SESSION_COOKIE_NAME,
  type AvailableSlotListResponse,
  type BookingListResponse,
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
const MINUTE_MS = 60 * 1000;

// Підмінений «зараз» і слоти відносно нього (Київ узимку — UTC+2).
const NOW = new Date('2026-11-02T09:30:00.000Z');
const TOMORROW_10 = '2026-11-03T08:00:00.000Z';
const TOMORROW_12 = '2026-11-03T10:00:00.000Z';

// Тестова база спільна для всіх файлів і не очищується: кожен тест створює власних студентів,
// кімнати й слоти, тож списки «Мої бронювання» містять лише записи цього тесту.
async function createRoom(name = `Кімната ${randomUUID()}`) {
  return prisma.room.create({
    data: {
      name,
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

// Бронювання створюється через API з #7, тож дедлайн і власник — ті самі, що в робочому коді.
async function bookSlot(cookie: string, slotId: string): Promise<BookingResponse['booking']> {
  const res = await request(app).post('/api/bookings').set('Cookie', cookie).send({ slotId });
  expect(res.status).toBe(201);
  return (res.body as BookingResponse).booking;
}

function list(cookie: string | null, scope?: string) {
  const req = request(app).get('/api/bookings');
  if (scope !== undefined) req.query({ scope });
  if (cookie) req.set('Cookie', cookie);
  return req;
}

function details(cookie: string | null, bookingId: string) {
  const req = request(app).get(`/api/bookings/${bookingId}`);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

// Клієнт шле Content-Type: application/json і для скасування з порожнім тілом (api_spec.md §1).
function cancel(cookie: string | null, bookingId: string) {
  const req = request(app).post(`/api/bookings/${bookingId}/cancel`).set('Content-Type', 'application/json');
  if (cookie) req.set('Cookie', cookie);
  return req;
}

function errorCode(res: request.Response): string {
  return (res.body as ErrorBody).error.code;
}

function listedIds(res: request.Response): string[] {
  return (res.body as BookingListResponse).bookings.map((b) => b.id);
}

beforeEach(() => {
  setClock(() => NOW);
});

afterEach(() => {
  resetClock();
});

describe('GET /api/bookings?scope=upcoming', () => {
  it('US-4.2-AC-01 власні активні бронювання з кімнатою й часом, за зростанням startsAt, із serverTime', async () => {
    const cookie = await studentCookie();
    const room = await createRoom();
    const later = await bookSlot(cookie, (await createSlot(room.id, TOMORROW_12)).id);
    const earlier = await bookSlot(cookie, (await createSlot(room.id, TOMORROW_10)).id);

    const res = await list(cookie, 'upcoming');

    expect(res.status).toBe(200);
    const body = res.body as BookingListResponse;
    expect(body.serverTime).toBe(NOW.toISOString());
    expect(body.bookings).toEqual([earlier, later]);
    expect(body.bookings[0]?.room).toEqual({
      id: room.id,
      name: room.name,
      building: room.building,
      floor: room.floor,
    });
  });

  it('US-4.2-AC-01 Q12 [Рішення команди]: поточне бронювання (слот почався, не завершився) у past, а не в upcoming', async () => {
    const cookie = await studentCookie();
    const booking = await bookSlot(cookie, (await createSlot((await createRoom()).id, TOMORROW_10)).id);
    setClock(() => new Date('2026-11-03T08:30:00.000Z'));

    expect(listedIds(await list(cookie, 'upcoming'))).toEqual([]);
    expect(listedIds(await list(cookie, 'past'))).toEqual([booking.id]);
  });

  it('US-4.2-AC-01 Q12 [Рішення команди]: до початку слота бронювання в upcoming, рівно на початку вже в past', async () => {
    const cookie = await studentCookie();
    const booking = await bookSlot(cookie, (await createSlot((await createRoom()).id, TOMORROW_10)).id);
    const start = new Date(TOMORROW_10).getTime();

    setClock(() => new Date(start - 1));
    expect(listedIds(await list(cookie, 'upcoming'))).toEqual([booking.id]);
    expect(listedIds(await list(cookie, 'past'))).toEqual([]);

    setClock(() => new Date(start));
    expect(listedIds(await list(cookie, 'upcoming'))).toEqual([]);
    expect(listedIds(await list(cookie, 'past'))).toEqual([booking.id]);
  });

  it('US-4.2-AC-02 чужі майбутні бронювання не потрапляють у список', async () => {
    const room = await createRoom();
    const mine = await studentCookie();
    const own = await bookSlot(mine, (await createSlot(room.id, TOMORROW_10)).id);
    await bookSlot(await studentCookie(), (await createSlot(room.id, TOMORROW_12)).id);

    expect(listedIds(await list(mine, 'upcoming'))).toEqual([own.id]);
  });

  it('US-4.2-AC-03 без власних майбутніх бронювань — 200 і порожній список', async () => {
    const res = await list(await studentCookie(), 'upcoming');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookings: [], serverTime: NOW.toISOString() });
  });

  it('scope відсутній або невідомий — 400 VALIDATION_ERROR', async () => {
    const cookie = await studentCookie();

    for (const scope of [undefined, 'all']) {
      const res = await list(cookie, scope);
      expect(res.status, String(scope)).toBe(400);
      expect(errorCode(res), String(scope)).toBe('VALIDATION_ERROR');
    }
  });
});

describe('GET /api/bookings?scope=past', () => {
  it('US-X.3-AC-01 скасовані й завершені власні бронювання зі збереженими статусами, за спаданням startsAt', async () => {
    const cookie = await studentCookie();
    const room = await createRoom();
    const cancelled = await bookSlot(cookie, (await createSlot(room.id, TOMORROW_12)).id);
    expect((await cancel(cookie, cancelled.id)).status).toBe(200);
    const finished = await bookSlot(cookie, (await createSlot(room.id, TOMORROW_10)).id);
    // Слот завершився, бронювання лишилося active: автоскасування в сценарії вимкнене.
    setClock(() => new Date('2026-11-03T09:30:00.000Z'));

    const res = await list(cookie, 'past');

    expect(res.status).toBe(200);
    const body = res.body as BookingListResponse;
    expect(body.bookings.map((b) => [b.id, b.status])).toEqual([
      [cancelled.id, 'cancelled_by_student'],
      [finished.id, 'active'],
    ]);
    expect(listedIds(await list(cookie, 'upcoming'))).toEqual([]);
  });

  it('US-X.3-AC-03 без власних минулих бронювань історія порожня й без чужих записів', async () => {
    const other = await studentCookie();
    const foreign = await bookSlot(other, (await createSlot((await createRoom()).id, TOMORROW_10)).id);
    expect((await cancel(other, foreign.id)).status).toBe(200);

    const res = await list(await studentCookie(), 'past');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookings: [], serverTime: NOW.toISOString() });
  });
});

describe('GET /api/bookings/:bookingId', () => {
  it('US-3.2a-AC-01 US-3.2a-AC-02 деталі кожного власного бронювання — саме його кімната й час', async () => {
    const cookie = await studentCookie();
    const roomA = await createRoom();
    const roomB = await createRoom();
    const slotA = await createSlot(roomA.id, TOMORROW_10);
    const slotB = await createSlot(roomB.id, TOMORROW_12, 2);
    const bookingA = await bookSlot(cookie, slotA.id);
    const bookingB = await bookSlot(cookie, slotB.id);

    for (const [booking, room, slot] of [
      [bookingA, roomA, slotA],
      [bookingB, roomB, slotB],
    ] as const) {
      const res = await details(cookie, booking.id);
      expect(res.status).toBe(200);
      const body = res.body as BookingResponse;
      expect(body.serverTime).toBe(NOW.toISOString());
      expect(body.booking).toEqual(booking);
      expect(body.booking.room.id).toBe(room.id);
      expect(body.booking.slot).toEqual({
        id: slot.id,
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
      });
    }
  });

  it('US-3.2b-AC-01 дедлайн власного активного бронювання = startsAt + grace period', async () => {
    const cookie = await studentCookie();
    const slot = await createSlot((await createRoom()).id, TOMORROW_10);
    const booking = await bookSlot(cookie, slot.id);

    const res = await details(cookie, booking.id);

    expect((res.body as BookingResponse).booking.deadline).toBe(
      new Date(slot.startsAt.getTime() + GRACE_PERIOD_MINUTES * MINUTE_MS).toISOString(),
    );
  });

  it('US-3.2b-AC-02 дедлайн переходить на наступну дату й не підміняється endsAt', async () => {
    const cookie = await studentCookie();
    // 23:50 за Києвом 03.11 → дедлайн 00:05 04.11 [залежить від H01].
    const slot = await createSlot((await createRoom()).id, '2026-11-03T21:50:00.000Z');
    const booking = await bookSlot(cookie, slot.id);

    const { booking: shown } = (await details(cookie, booking.id)).body as BookingResponse;
    expect(shown.deadline).toBe('2026-11-03T22:05:00.000Z');
    expect(shown.deadline).not.toBe(shown.slot.endsAt);
  });

  it('US-3.2b-AC-03 [залежить від H01] початок о 14:00 за Києвом — дедлайн 14:15', async () => {
    const cookie = await studentCookie();
    const slot = await createSlot((await createRoom()).id, '2026-11-03T12:00:00.000Z');
    const booking = await bookSlot(cookie, slot.id);

    const { booking: shown } = (await details(cookie, booking.id)).body as BookingResponse;

    expect(shown.deadline).toBe('2026-11-03T12:15:00.000Z');
  });

  it('US-X.1a-AC-03 чуже й неіснуюче бронювання — однакова 404 BOOKING_NOT_FOUND', async () => {
    const foreign = await bookSlot(
      await studentCookie(),
      (await createSlot((await createRoom()).id, TOMORROW_10)).id,
    );
    const cookie = await studentCookie();

    const foreignRes = await details(cookie, foreign.id);
    const missingRes = await details(cookie, randomUUID());

    expect(foreignRes.status).toBe(404);
    expect(missingRes.status).toBe(404);
    expect(foreignRes.body).toEqual(missingRes.body);
    expect(errorCode(foreignRes)).toBe('BOOKING_NOT_FOUND');
  });

  it('bookingId не UUID — 400 VALIDATION_ERROR', async () => {
    const res = await details(await studentCookie(), 'not-a-uuid');

    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/bookings/:bookingId/cancel', () => {
  it('US-4.3-AC-01 US-4.3-AC-02 один запит переводить власне активне бронювання в cancelled_by_student', async () => {
    const cookie = await studentCookie();
    const booking = await bookSlot(cookie, (await createSlot((await createRoom()).id, TOMORROW_10)).id);
    const cancelAt = new Date('2026-11-02T10:00:00.000Z');
    setClock(() => cancelAt);

    const res = await cancel(cookie, booking.id);

    expect(res.status).toBe(200);
    const body = res.body as BookingResponse;
    expect(body.serverTime).toBe(cancelAt.toISOString());
    expect(body.booking).toEqual({
      ...booking,
      status: 'cancelled_by_student',
      cancelledAt: cancelAt.toISOString(),
    });
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('cancelled_by_student');
    expect(stored.cancelledAt?.toISOString()).toBe(cancelAt.toISOString());
  });

  it('US-4.3-AC-03 SYS-AC-10 після скасування слот знову вільний і його бронює інший студент', async () => {
    const room = await createRoom();
    const slot = await createSlot(room.id, TOMORROW_10);
    const owner = await studentCookie();
    const booking = await bookSlot(owner, slot.id);
    expect((await cancel(owner, booking.id)).status).toBe(200);

    const other = await studentCookie();
    const available = await request(app)
      .get(`/api/rooms/${room.id}/available-slots`)
      .query({ date: '2026-11-03' })
      .set('Cookie', other);
    expect((available.body as AvailableSlotListResponse).slots.map((s) => s.id)).toContain(slot.id);

    const rebooked = await bookSlot(other, slot.id);
    expect(rebooked.status).toBe('active');
  });

  it('US-4.3-AC-04 US-X.1a-AC-03 чуже бронювання не скасовується: 404 BOOKING_NOT_FOUND, запис без змін', async () => {
    const booking = await bookSlot(
      await studentCookie(),
      (await createSlot((await createRoom()).id, TOMORROW_10)).id,
    );

    const res = await cancel(await studentCookie(), booking.id);

    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('BOOKING_NOT_FOUND');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('active');
    expect(stored.cancelledAt).toBeNull();
  });

  it('SYS-AC-05 повторне скасування — 409 BOOKING_STATUS_CONFLICT з currentStatus, запис не відновлюється', async () => {
    const cookie = await studentCookie();
    const booking = await bookSlot(cookie, (await createSlot((await createRoom()).id, TOMORROW_10)).id);
    expect((await cancel(cookie, booking.id)).status).toBe(200);
    const firstCancel = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    setClock(() => new Date('2026-11-02T11:00:00.000Z'));

    const res = await cancel(cookie, booking.id);

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).error).toMatchObject({
      code: 'BOOKING_STATUS_CONFLICT',
      details: { currentStatus: 'cancelled_by_student' },
    });
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toEqual(firstCancel);
  });

  it('FB-1 підтверджене бронювання не скасовується студентом — 409 з currentStatus confirmed', async () => {
    const cookie = await studentCookie();
    const booking = await bookSlot(cookie, (await createSlot((await createRoom()).id, TOMORROW_10)).id);
    // Check-in у сценарії вимкнений, тож статус confirmed задається напряму в БД.
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'confirmed', confirmedAt: NOW, confirmedById: await userIdOf(cookie) },
    });

    const res = await cancel(cookie, booking.id);

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).error).toMatchObject({
      code: 'BOOKING_STATUS_CONFLICT',
      details: { currentStatus: 'confirmed' },
    });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('confirmed');
  });

  it('Q07 [Рішення команди]: активне бронювання, що вже почалося, студент скасовує', async () => {
    const cookie = await studentCookie();
    const booking = await bookSlot(cookie, (await createSlot((await createRoom()).id, TOMORROW_10)).id);
    setClock(() => new Date('2026-11-03T08:30:00.000Z'));

    const res = await cancel(cookie, booking.id);

    expect(res.status).toBe(200);
    expect((res.body as BookingResponse).booking.status).toBe('cancelled_by_student');
  });

  it('без Content-Type: application/json — 400 VALIDATION_ERROR з reason invalid_content_type, запис без змін', async () => {
    const cookie = await studentCookie();
    const booking = await bookSlot(cookie, (await createSlot((await createRoom()).id, TOMORROW_10)).id);

    const res = await request(app).post(`/api/bookings/${booking.id}/cancel`).set('Cookie', cookie);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fields: [{ path: 'body', reason: 'invalid_content_type' }] },
    });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('active');
  });

  it('bookingId не UUID — 400 VALIDATION_ERROR', async () => {
    const res = await cancel(await studentCookie(), 'not-a-uuid');

    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
  });
});

describe('доступ і повний цикл', () => {
  it('адміністратор отримує 403 FORBIDDEN на всіх трьох ендпоінтах', async () => {
    const booking = await bookSlot(
      await studentCookie(),
      (await createSlot((await createRoom()).id, TOMORROW_10)).id,
    );
    const admin = await adminCookie();

    for (const res of [
      await list(admin, 'upcoming'),
      await details(admin, booking.id),
      await cancel(admin, booking.id),
    ]) {
      expect(res.status).toBe(403);
      expect(errorCode(res)).toBe('FORBIDDEN');
    }
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('active');
  });

  it('гість отримує 401 UNAUTHENTICATED на всіх трьох ендпоінтах', async () => {
    const booking = await bookSlot(
      await studentCookie(),
      (await createSlot((await createRoom()).id, TOMORROW_10)).id,
    );

    for (const res of [
      await list(null, 'upcoming'),
      await details(null, booking.id),
      await cancel(null, booking.id),
    ]) {
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe('UNAUTHENTICATED');
    }
  });

  it('повний цикл: створити → побачити → скасувати → слот знову вільний і бронюється повторно', async () => {
    const room = await createRoom();
    const slot = await createSlot(room.id, TOMORROW_10);
    const cookie = await studentCookie();

    const booking = await bookSlot(cookie, slot.id);
    expect(listedIds(await list(cookie, 'upcoming'))).toEqual([booking.id]);
    expect((await details(cookie, booking.id)).status).toBe(200);

    expect((await cancel(cookie, booking.id)).status).toBe(200);
    expect(listedIds(await list(cookie, 'upcoming'))).toEqual([]);
    expect(listedIds(await list(cookie, 'past'))).toEqual([booking.id]);

    const available = await request(app)
      .get(`/api/rooms/${room.id}/available-slots`)
      .query({ date: '2026-11-03' })
      .set('Cookie', cookie);
    expect((available.body as AvailableSlotListResponse).slots.map((s) => s.id)).toContain(slot.id);

    const again = await bookSlot(cookie, slot.id);
    expect(again.id).not.toBe(booking.id);
    expect(listedIds(await list(cookie, 'upcoming'))).toEqual([again.id]);
  });
});
