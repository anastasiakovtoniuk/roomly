import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GRACE_PERIOD_MINUTES,
  type AvailableSlotListResponse,
  type BookingListResponse,
  type BookingResponse,
  type ErrorBody,
} from '@roomly/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { resetClock, setClock } from '../src/lib/clock';
import { cancelExpiredBookings } from '../src/modules/bookings/autoCancel';
import { startAutoCancelScheduler } from '../src/modules/bookings/autoCancelScheduler';
import { registerStudent } from './helpers/auth';

const app = createApp();
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// Слот завтра о 10:00 за Києвом (UTC+2 узимку); дедлайн — початок + grace period (H01).
const SLOT_START = new Date('2026-11-03T08:00:00.000Z');
const DEADLINE = new Date(SLOT_START.getTime() + GRACE_PERIOD_MINUTES * MINUTE_MS);
const BEFORE_DEADLINE = new Date(DEADLINE.getTime() - 5 * MINUTE_MS);
const AFTER_DEADLINE = new Date(DEADLINE.getTime() + 5 * MINUTE_MS);
const BOOKED_AT = new Date('2026-11-02T09:30:00.000Z');

// Усі тести пишуть у спільну базу й створюють власні кімнати, слоти й користувачів. Тести лишають
// після себе прострочені `active`-записи: ліниве автоскасування чіпає їх, але не чужі `confirmed`.
async function createUser() {
  return prisma.user.create({
    data: { name: 'Тест', email: `user-${randomUUID()}@example.com`, passwordHash: 'not-a-real-hash' },
  });
}

async function createSlot(startsAt = SLOT_START) {
  const room = await prisma.room.create({
    data: {
      name: `Кімната ${randomUUID()}`,
      capacity: 6,
      building: 'Корпус 1',
      floor: 2,
      equipment: JSON.stringify([]),
      qrToken: `qr-${randomUUID()}`,
    },
  });
  return prisma.slot.create({
    data: { roomId: room.id, startsAt, endsAt: new Date(startsAt.getTime() + HOUR_MS) },
  });
}

// Запис напряму через Prisma: стани `confirmed` і `auto_cancelled` через API поки недосяжні.
async function insertBooking(status: string, slotStartsAt = SLOT_START, userId?: string) {
  const slot = await createSlot(slotStartsAt);
  const owner = userId ?? (await createUser()).id;
  return prisma.booking.create({
    data: {
      userId: owner,
      slotId: slot.id,
      status,
      deadline: new Date(slotStartsAt.getTime() + GRACE_PERIOD_MINUTES * MINUTE_MS),
      createdAt: BOOKED_AT,
      ...(status === 'confirmed' ? { confirmedAt: BEFORE_DEADLINE } : {}),
      ...(status === 'cancelled_by_student' ? { cancelledAt: BEFORE_DEADLINE } : {}),
    },
  });
}

async function statusOf(bookingId: string): Promise<string> {
  return (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status;
}

const studentCookie = async () => (await registerStudent(app)).cookie;

function errorCode(res: request.Response): string {
  return (res.body as ErrorBody).error.code;
}

beforeEach(() => {
  setClock(() => BOOKED_AT);
});

afterEach(() => {
  resetClock();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('cancelExpiredBookings', () => {
  it('SYS-AC-02 активне бронювання з минулим дедлайном стає auto_cancelled, cancelledAt = момент перевірки', async () => {
    const booking = await insertBooking('active');

    const changed = await cancelExpiredBookings(AFTER_DEADLINE);

    expect(changed).toBeGreaterThanOrEqual(1);
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('auto_cancelled');
    expect(stored.cancelledAt?.toISOString()).toBe(AFTER_DEADLINE.toISOString());
  });

  it('SYS-AC-02 активне бронювання до дедлайну лишається active', async () => {
    const booking = await insertBooking('active');

    await cancelExpiredBookings(BEFORE_DEADLINE);

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('active');
    expect(stored.cancelledAt).toBeNull();
  });

  it('SYS-AC-03 підтверджене бронювання не змінюється після дедлайну', async () => {
    const booking = await insertBooking('confirmed');

    await cancelExpiredBookings(AFTER_DEADLINE);

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('confirmed');
    expect(stored.confirmedAt?.toISOString()).toBe(BEFORE_DEADLINE.toISOString());
    expect(stored.cancelledAt).toBeNull();
  });

  it('SYS-AC-05 скасоване студентом не переписується на auto_cancelled, повторний виклик нічого не змінює', async () => {
    const cancelled = await insertBooking('cancelled_by_student');
    const expired = await insertBooking('active');

    await cancelExpiredBookings(AFTER_DEADLINE);
    const secondRun = await cancelExpiredBookings(AFTER_DEADLINE);

    expect(secondRun).toBe(0);
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: cancelled.id } });
    expect(stored.status).toBe('cancelled_by_student');
    expect(stored.cancelledAt?.toISOString()).toBe(BEFORE_DEADLINE.toISOString());
    expect(await statusOf(expired.id)).toBe('auto_cancelled');
  });

  it('SYS-AC-10 після автоскасування слот не утримується живим бронюванням і його можна зайняти знову', async () => {
    const booking = await insertBooking('active');
    await cancelExpiredBookings(AFTER_DEADLINE);

    const rebooked = await prisma.booking.create({
      data: {
        userId: (await createUser()).id,
        slotId: booking.slotId,
        status: 'active',
        deadline: DEADLINE,
        createdAt: AFTER_DEADLINE,
      },
    });

    expect(rebooked.status).toBe('active');
    expect(await statusOf(booking.id)).toBe('auto_cancelled');
  });
});

describe('ліниве автоскасування (ADR-0006): виконується перед відповіддю, без таймера', () => {
  it('US-X.3-AC-02 SYS-AC-02 «Минулі» повертають auto_cancelled, а скасувати такий запис не можна', async () => {
    const cookie = await studentCookie();
    const slot = await createSlot();
    const booked = await request(app).post('/api/bookings').set('Cookie', cookie).send({ slotId: slot.id });
    expect(booked.status).toBe(201);
    const id = (booked.body as BookingResponse).booking.id;
    setClock(() => AFTER_DEADLINE);

    const past = await request(app).get('/api/bookings?scope=past').set('Cookie', cookie);

    expect(past.status).toBe(200);
    const found = (past.body as BookingListResponse).bookings.find((b) => b.id === id);
    expect(found?.status).toBe('auto_cancelled');
    expect(found?.cancelledAt).toBe(AFTER_DEADLINE.toISOString());

    const cancel = await request(app)
      .post(`/api/bookings/${id}/cancel`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json');
    expect(cancel.status).toBe(409);
    expect(errorCode(cancel)).toBe('BOOKING_STATUS_CONFLICT');
    expect((cancel.body as ErrorBody).error.details).toEqual({ currentStatus: 'auto_cancelled' });
  });

  it('US-3.2b деталі бронювання після дедлайну показують auto_cancelled', async () => {
    const cookie = await studentCookie();
    const slot = await createSlot();
    const booked = await request(app).post('/api/bookings').set('Cookie', cookie).send({ slotId: slot.id });
    const id = (booked.body as BookingResponse).booking.id;
    setClock(() => AFTER_DEADLINE);

    const res = await request(app).get(`/api/bookings/${id}`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect((res.body as BookingResponse).booking.status).toBe('auto_cancelled');
  });

  // Функція скасування глобальна, не прив'язана до користувача: кожна точка входу з api_spec.md §1
  // має скасувати прострочений запис іншого користувача.
  it.each([
    [
      'GET /api/bookings',
      (cookie: string) => request(app).get('/api/bookings?scope=upcoming').set('Cookie', cookie),
    ],
    [
      'GET /api/bookings/:id',
      (cookie: string) => request(app).get(`/api/bookings/${randomUUID()}`).set('Cookie', cookie),
    ],
    [
      'POST /api/bookings',
      (cookie: string) =>
        request(app).post('/api/bookings').set('Cookie', cookie).send({ slotId: randomUUID() }),
    ],
    [
      'POST /api/bookings/:id/cancel',
      (cookie: string) =>
        request(app)
          .post(`/api/bookings/${randomUUID()}/cancel`)
          .set('Cookie', cookie)
          .set('Content-Type', 'application/json'),
    ],
  ])('SYS-AC-02 %s скасовує прострочений запис перед відповіддю', async (_name, call) => {
    const expired = await insertBooking('active');
    const cookie = await studentCookie();
    setClock(() => AFTER_DEADLINE);

    await call(cookie);

    expect(await statusOf(expired.id)).toBe('auto_cancelled');
  });

  it('SYS-AC-02 GET /api/rooms/:id/available-slots скасовує прострочений запис перед відповіддю', async () => {
    const expired = await insertBooking('active');
    const slot = await prisma.slot.findUniqueOrThrow({ where: { id: expired.slotId } });
    const cookie = await studentCookie();
    setClock(() => AFTER_DEADLINE);

    const res = await request(app)
      .get(`/api/rooms/${slot.roomId}/available-slots?date=2026-11-03`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(await statusOf(expired.id)).toBe('auto_cancelled');
    // G1 варіант «а»: слот, що почався, не пропонується, тож позначка US-2.6 лишається false.
    expect((res.body as AvailableSlotListResponse).slots).toEqual([]);
  });

  it('SYS-AC-02 перед дедлайном ліниве скасування нічого не змінює', async () => {
    const booking = await insertBooking('active');
    const cookie = await studentCookie();
    setClock(() => BEFORE_DEADLINE);

    await request(app).get('/api/bookings?scope=past').set('Cookie', cookie);

    expect(await statusOf(booking.id)).toBe('active');
  });
});

describe('планувальник автоскасування (Q16: інтервал із ADR-0006)', () => {
  it('SYS-AC-02 за інтервалом скасовує прострочене без жодного запиту, зупинка припиняє перевірки', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const first = await insertBooking('active');
    setClock(() => AFTER_DEADLINE);

    const stop = startAutoCancelScheduler(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(async () => expect(await statusOf(first.id)).toBe('auto_cancelled'));

    stop();
    const second = await insertBooking('active');
    await vi.advanceTimersByTimeAsync(5000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await statusOf(second.id)).toBe('active');
  });

  it('SYS-AC-02 помилка однієї ітерації логується й не зупиняє планувальник', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('база тимчасово недоступна'))
      .mockResolvedValue(0);

    const stop = startAutoCancelScheduler(1000, run);
    await vi.advanceTimersByTimeAsync(2000);
    stop();

    expect(run).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
