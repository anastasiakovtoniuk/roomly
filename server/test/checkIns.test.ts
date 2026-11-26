import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GRACE_PERIOD_MINUTES, type CheckInResult, type ErrorBody } from '@roomly/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import type { Prisma } from '../src/generated/prisma/client';
import { setClock } from '../src/lib/clock';
import { adminSession, registerStudent } from './helpers/auth';
import { createBookingRow, createRoom, createSlot } from './helpers/factories';
import { at, useClock } from './helpers/time';

const app = createApp();

// Слот о 10:00 за Києвом (UTC+2 узимку); дедлайн — початок + grace period (H01). Моменти рівно на
// початку слота й рівно в дедлайн не перевіряються (Q01, checkin_admin_flow.md, рішення 4).
const SLOT_START = '2026-11-03T08:00:00.000Z';
const IN_GRACE = at(SLOT_START, 5);
const AFTER_DEADLINE = at(SLOT_START, GRACE_PERIOD_MINUTES + 5);

// Кімната з поточним слотом і бронюванням власника в заданому статусі. Кожен тест має власну
// кімнату, тож результат скану залежить лише від його записів.
async function roomWithBooking(ownerId: string, status: 'active' | 'cancelled_by_student' = 'active') {
  const room = await createRoom();
  const slot = await createSlot(room.id, SLOT_START);
  const booking = await createBookingRow(status, { slotId: slot.id, userId: ownerId });
  return { room, slot, booking };
}

function scan(cookie: string | null, qrToken: string) {
  const req = request(app).post('/api/check-ins');
  if (cookie) req.set('Cookie', cookie);
  return req.send({ qrToken });
}

function errorCode(res: request.Response) {
  return (res.body as ErrorBody).error.code;
}

// Детерміноване переплетення для SYS-AC-07: паралельні HTTP-запити на тестовій SQLite виконуються
// по черзі й гонки не відтворюють. Тому між читанням бронювання й умовним оновленням сервісу
// конкурентна дія виконується справжнім записом у ту саму БД, а потім — справжній updateMany
// сервісу. Prisma не мокається: перевіряється, що умова оновлення не переписує чужий перехід.
// Перехоплюється лише оновлення в `confirmed`: першим updateMany викликає ліниве автоскасування.
function competingTransitionBeforeConfirm(bookingId: string, data: Prisma.BookingUncheckedUpdateManyInput) {
  const realUpdateMany = prisma.booking.updateMany.bind(prisma.booking);
  let competed = false;
  vi.spyOn(prisma.booking, 'updateMany').mockImplementation((args) => {
    if (competed || args.data.status !== 'confirmed') return realUpdateMany(args);
    competed = true;
    // Сервіс лише очікує результат, тому звичайний Promise замість PrismaPromise для нього достатній.
    return realUpdateMany({ where: { id: bookingId }, data }).then(() =>
      realUpdateMany(args),
    ) as unknown as ReturnType<typeof realUpdateMany>;
  });
}

describe('POST /api/check-ins', () => {
  useClock(IN_GRACE);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('US-5.1-AC-01: власник скануює QR у межах grace period — бронювання підтверджене', async () => {
    const owner = await registerStudent(app);
    const { room, booking } = await roomWithBooking(owner.userId);

    const res = await scan(owner.cookie, room.qrToken);

    expect(res.status).toBe(200);
    const body = res.body as CheckInResult;
    expect(body.result).toBe('confirmed');
    expect(body.serverTime).toBe(IN_GRACE.toISOString());
    expect(body.booking).toMatchObject({
      id: booking.id,
      status: 'confirmed',
      confirmedAt: IN_GRACE.toISOString(),
      confirmedBy: 'student',
      cancelledAt: null,
    });
    // Токен QR не повертається у відповідях (FB-12).
    expect(JSON.stringify(res.body)).not.toContain(room.qrToken);

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('confirmed');
    expect(stored.confirmedAt?.toISOString()).toBe(IN_GRACE.toISOString());
    expect(stored.confirmedById).toBe(owner.userId);
  });

  it('US-5.1-AC-05: повторний скан дає already_confirmed без зміни confirmedAt і без нового бронювання', async () => {
    const owner = await registerStudent(app);
    const { room, slot, booking } = await roomWithBooking(owner.userId);

    expect((await scan(owner.cookie, room.qrToken)).status).toBe(200);

    const later = at(IN_GRACE, 3);
    setClock(() => later);
    const res = await scan(owner.cookie, room.qrToken);

    expect(res.status).toBe(200);
    const body = res.body as CheckInResult;
    expect(body.result).toBe('already_confirmed');
    expect(body.serverTime).toBe(later.toISOString());
    expect(body.booking).toMatchObject({
      id: booking.id,
      status: 'confirmed',
      confirmedAt: IN_GRACE.toISOString(),
    });

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.confirmedAt?.toISOString()).toBe(IN_GRACE.toISOString());
    expect(await prisma.booking.count({ where: { slotId: slot.id } })).toBe(1);
  });

  it('US-5.2-AC-01, US-5.2-AC-04: інший студент підтверджує бронювання кімнати, власник той самий і без нових прав', async () => {
    const owner = await registerStudent(app, 'Власниця');
    const other = await registerStudent(app, 'Інший');
    const { room, booking } = await roomWithBooking(owner.userId);

    const res = await scan(other.cookie, room.qrToken);

    expect(res.status).toBe(200);
    const body = res.body as CheckInResult;
    expect(body.result).toBe('confirmed');
    expect(body.booking).toMatchObject({ id: booking.id, status: 'confirmed', confirmedBy: 'student' });
    // Booking без даних власника й без id того, хто підтвердив (BR-8, US-5.2-AC-04).
    expect(Object.keys(body.booking).sort()).toEqual(
      [
        'cancelledAt',
        'confirmedAt',
        'confirmedBy',
        'createdAt',
        'deadline',
        'id',
        'room',
        'slot',
        'status',
      ].sort(),
    );

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.userId).toBe(owner.userId);
    expect(stored.confirmedById).toBe(other.userId);

    // Підтвердження не дає права читати чи скасовувати чуже бронювання.
    const details = await request(app).get(`/api/bookings/${booking.id}`).set('Cookie', other.cookie);
    expect(details.status).toBe(404);
    expect(errorCode(details)).toBe('BOOKING_NOT_FOUND');
    const cancel = await request(app)
      .post(`/api/bookings/${booking.id}/cancel`)
      .set('Cookie', other.cookie)
      .send({});
    expect(cancel.status).toBe(404);
    expect(errorCode(cancel)).toBe('BOOKING_NOT_FOUND');
  });

  it('US-5.2-AC-03: гість отримує UNAUTHENTICATED, адміністратор FORBIDDEN, бронювання лишається активним', async () => {
    const owner = await registerStudent(app);
    const admin = await adminSession(app);
    const { room, booking } = await roomWithBooking(owner.userId);

    const guest = await scan(null, room.qrToken);
    expect(guest.status).toBe(401);
    expect(errorCode(guest)).toBe('UNAUTHENTICATED');

    const asAdmin = await scan(admin.cookie, room.qrToken);
    expect(asAdmin.status).toBe(403);
    expect(errorCode(asAdmin)).toBe('FORBIDDEN');

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('active');
    expect(stored.confirmedAt).toBeNull();
    expect(stored.confirmedById).toBeNull();
  });

  it('US-5.1-AC-03: невідомий чи некоректний QR не підтверджує жодного бронювання', async () => {
    const student = await registerStudent(app);
    const { booking } = await roomWithBooking(student.userId);

    const unknown = await scan(student.cookie, `unknown-${booking.id}`);
    expect(unknown.status).toBe(422);
    expect(errorCode(unknown)).toBe('QR_UNKNOWN');

    const empty = await scan(student.cookie, '');
    expect(empty.status).toBe(400);
    expect(errorCode(empty)).toBe('VALIDATION_ERROR');

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('active');
    expect(stored.confirmedAt).toBeNull();
  });

  it('US-5.1-AC-04: у кімнаті немає поточного бронювання або воно скасоване — NO_CURRENT_BOOKING без змін', async () => {
    const student = await registerStudent(app);
    const emptyRoom = await createRoom();
    await createSlot(emptyRoom.id, SLOT_START);

    const noBooking = await scan(student.cookie, emptyRoom.qrToken);
    expect(noBooking.status).toBe(422);
    expect(errorCode(noBooking)).toBe('NO_CURRENT_BOOKING');
    expect(await prisma.booking.count({ where: { slot: { roomId: emptyRoom.id } } })).toBe(0);

    const { room, booking } = await roomWithBooking(student.userId, 'cancelled_by_student');
    const cancelled = await scan(student.cookie, room.qrToken);
    expect(cancelled.status).toBe(422);
    expect(errorCode(cancelled)).toBe('NO_CURRENT_BOOKING');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('cancelled_by_student');
    expect(stored.confirmedAt).toBeNull();
  });

  it('US-5.1-AC-06, US-5.6b-AC-03: скан після дедлайну — CHECK_IN_WINDOW_CLOSED, запис автоскасований і не відновлений', async () => {
    const owner = await registerStudent(app);
    const { room, booking } = await roomWithBooking(owner.userId);
    setClock(() => AFTER_DEADLINE);

    const res = await scan(owner.cookie, room.qrToken);

    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('CHECK_IN_WINDOW_CLOSED');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('auto_cancelled');
    expect(stored.deadline.toISOString()).toBe(booking.deadline.toISOString());
    expect(stored.confirmedAt).toBeNull();
    expect(stored.confirmedById).toBeNull();

    // Повтор після автоскасування дає той самий результат (US-5.6b-AC-03).
    const retry = await scan(owner.cookie, room.qrToken);
    expect(retry.status).toBe(422);
    expect(errorCode(retry)).toBe('CHECK_IN_WINDOW_CLOSED');
  });

  it('SYS-AC-07: автоскасування виграло гонку після читання — CHECK_IN_WINDOW_CLOSED, автоскасований запис не переписано', async () => {
    const owner = await registerStudent(app);
    const { room, booking } = await roomWithBooking(owner.userId);
    competingTransitionBeforeConfirm(booking.id, {
      status: 'auto_cancelled',
      cancelledAt: IN_GRACE,
    });

    const res = await scan(owner.cookie, room.qrToken);

    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('CHECK_IN_WINDOW_CLOSED');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('auto_cancelled');
    expect(stored.confirmedAt).toBeNull();
    expect(stored.confirmedById).toBeNull();
  });

  it('SYS-AC-07, US-5.1-AC-05: інше підтвердження виграло гонку після читання — already_confirmed без перезапису', async () => {
    const owner = await registerStudent(app, 'Власниця');
    const other = await registerStudent(app, 'Інший');
    const { room, booking } = await roomWithBooking(owner.userId);
    const firstConfirmedAt = at(IN_GRACE, -1);
    competingTransitionBeforeConfirm(booking.id, {
      status: 'confirmed',
      confirmedAt: firstConfirmedAt,
      confirmedById: other.userId,
    });

    const res = await scan(owner.cookie, room.qrToken);

    expect(res.status).toBe(200);
    expect((res.body as CheckInResult).result).toBe('already_confirmed');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('confirmed');
    expect(stored.confirmedAt?.toISOString()).toBe(firstConfirmedAt.toISOString());
    expect(stored.confirmedById).toBe(other.userId);
  });

  it('US-5.1-AC-01, US-5.1-AC-06: на поточному слоті живий запис має пріоритет перед автоскасованим, який не відновлюється', async () => {
    const owner = await registerStudent(app);
    const room = await createRoom();
    const slot = await createSlot(room.id, SLOT_START);
    // Стан, який через API не отримати (Q04 «а»), але допускає BR-1: автоскасований і живий запис на одному слоті.
    const cancelled = await createBookingRow('auto_cancelled', { slotId: slot.id });
    const live = await createBookingRow('active', { slotId: slot.id, userId: owner.userId });

    const res = await scan(owner.cookie, room.qrToken);

    expect(res.status).toBe(200);
    expect((res.body as CheckInResult).booking).toMatchObject({ id: live.id, status: 'confirmed' });
    const storedCancelled = await prisma.booking.findUniqueOrThrow({ where: { id: cancelled.id } });
    expect(storedCancelled.status).toBe('auto_cancelled');
    expect(storedCancelled.confirmedAt).toBeNull();
  });

  it('US-5.1-AC-04, Q01 [Рішення команди]: бронювання кімнати ще не почалося — CHECK_IN_TOO_EARLY без змін', async () => {
    const owner = await registerStudent(app);
    const room = await createRoom();
    // Наступний слот кімнати; момент рівно на startsAt не перевіряється (Q01).
    const laterSlot = await createSlot(room.id, at(SLOT_START, 60));
    const booking = await createBookingRow('active', { slotId: laterSlot.id, userId: owner.userId });

    const res = await scan(owner.cookie, room.qrToken);

    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('CHECK_IN_TOO_EARLY');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('active');
    expect(stored.confirmedAt).toBeNull();
    expect(stored.confirmedById).toBeNull();
  });
});
