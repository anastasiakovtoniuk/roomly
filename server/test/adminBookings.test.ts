import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type {
  AdminBooking,
  AdminBookingListResponse,
  BookingListResponse,
  CheckInResult,
  ErrorBody,
} from '@roomly/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { AppError } from '../src/lib/appError';
import { setClock } from '../src/lib/clock';
import { confirmBooking } from '../src/modules/admin/adminBookings.service';
import { cancelExpiredBookings } from '../src/modules/bookings/autoCancel';
import { adminSession, registerStudent } from './helpers/auth';
import { createBookingRow, createRoom, createSlot, createUser } from './helpers/factories';
import { at, useClock } from './helpers/time';

const app = createApp();

// Слот о 10:00 за Києвом; дедлайн — початок + grace period (15 хв, H01) за createBookingRow.
const SLOT_START = '2026-11-03T08:00:00.000Z';
const DEADLINE = at(SLOT_START, 15);
const IN_GRACE = at(SLOT_START, 5);
const AFTER_DEADLINE = at(DEADLINE, 1);
const BEFORE_START = at(SLOT_START, -1);

const MISSING_BOOKING_ID = '00000000-0000-4000-8000-000000000000';

function errorBody(res: request.Response) {
  return (res.body as ErrorBody).error;
}

function listBookings(cookie: string | null) {
  const req = request(app).get('/api/admin/bookings');
  if (cookie) req.set('Cookie', cookie);
  return req;
}

// Тіло порожнє, але JSON: requireJson інакше відповів би VALIDATION_ERROR раніше за перевірку ролі.
function confirm(cookie: string | null, bookingId: string) {
  const req = request(app).post(`/api/admin/bookings/${bookingId}/confirm`);
  if (cookie) req.set('Cookie', cookie);
  return req.send({});
}

// Бронювання на власному слоті власної кімнати, щоб тести не залежали від чужих записів спільної БД.
async function bookingFor(
  userId: string,
  status: 'active' | 'confirmed' | 'cancelled_by_student' | 'auto_cancelled' = 'active',
  startsAt: string | Date = SLOT_START,
) {
  const room = await createRoom();
  const slot = await createSlot(room.id, startsAt);
  return createBookingRow(status, { slotId: slot.id, userId });
}

// Студент напряму в БД (bcrypt cost 4): більшості тестів потрібен лише власник бронювання, а не його
// сесія. Справжня реєстрація через API — лише там, де студент сам робить запит (SYS-AC-09).
async function newStudent(name?: string) {
  const user = await createUser({ name: name ?? 'Студент' });
  return { userId: user.id };
}

function own(body: AdminBookingListResponse, ids: string[]): AdminBooking[] {
  return body.bookings.filter((booking) => ids.includes(booking.id));
}

// Бронювання з відповіді за id. Відсутність — явне падіння з id, а не undefined, який далі
// перевірявся б через `?.` і давав невиразне повідомлення.
function bookingIn(body: AdminBookingListResponse, id: string): AdminBooking {
  const found = body.bookings.find((booking) => booking.id === id);
  if (found === undefined) {
    throw new Error(`Бронювання ${id} немає у відповіді GET /api/admin/bookings`);
  }
  return found;
}

describe('GET /api/admin/bookings', () => {
  useClock(IN_GRACE);

  it('US-A.5-AC-01: адміністратор бачить бронювання двох різних студентів із власником { id, name, email }', async () => {
    const admin = await adminSession(app);
    const olena = await newStudent(`Олена ${randomUUID()}`);
    const petro = await newStudent(`Петро ${randomUUID()}`);
    const first = await bookingFor(olena.userId);
    const second = await bookingFor(petro.userId);

    const res = await listBookings(admin.cookie);

    expect(res.status).toBe(200);
    const body = res.body as AdminBookingListResponse;
    expect(body.serverTime).toBe(IN_GRACE.toISOString());
    for (const [booking, userId] of [
      [first, olena.userId],
      [second, petro.userId],
    ] as const) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const found = bookingIn(body, booking.id);
      expect(found).toMatchObject({ id: booking.id, status: 'active' });
      // Рівно три поля власника (toEqual, не toMatchObject): без passwordHash, ролі й сесій (BR-8).
      expect(found.student).toEqual({ id: user.id, name: user.name, email: user.email });
    }
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  it('US-A.5-AC-02: статуси збережені й відрізняються — active, confirmed, cancelled_by_student, auto_cancelled', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const rows = {
      active: await bookingFor(student.userId, 'active'),
      confirmed: await bookingFor(student.userId, 'confirmed'),
      cancelled_by_student: await bookingFor(student.userId, 'cancelled_by_student'),
      auto_cancelled: await bookingFor(student.userId, 'auto_cancelled'),
    };

    const body = (await listBookings(admin.cookie)).body as AdminBookingListResponse;

    for (const [status, row] of Object.entries(rows)) {
      expect(bookingIn(body, row.id).status, status).toBe(status);
    }
  });

  it('US-A.5-AC-02 (ADR-0006): прострочене active у відповіді й у БД уже auto_cancelled', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const booking = await bookingFor(student.userId);
    setClock(() => AFTER_DEADLINE);

    const body = (await listBookings(admin.cookie)).body as AdminBookingListResponse;

    expect(bookingIn(body, booking.id)).toMatchObject({
      status: 'auto_cancelled',
      cancelledAt: AFTER_DEADLINE.toISOString(),
    });
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('auto_cancelled');
  });

  it('US-A.5-AC-01: бронювання впорядковані за спаданням slot.startsAt', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const early = await bookingFor(student.userId, 'confirmed', at(SLOT_START, -24 * 60));
    const late = await bookingFor(student.userId, 'active', at(SLOT_START, 24 * 60));
    const middle = await bookingFor(student.userId, 'active', SLOT_START);

    const body = (await listBookings(admin.cookie)).body as AdminBookingListResponse;

    expect(own(body, [early.id, late.id, middle.id]).map((b) => b.id)).toEqual([
      late.id,
      middle.id,
      early.id,
    ]);
    const starts = body.bookings.map((b) => Date.parse(b.slot.startsAt));
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
  });

  // Спільна test.db не порожня й не очищується (ADR-0008), тож буквальний порожній список тут не
  // відтворюється; перевіряється суть критерію — у списку лише записи, що справді є в БД.
  it('US-A.5-AC-03: список містить рівно бронювання з БД, без вигаданих записів', async () => {
    const admin = await adminSession(app);

    const body = (await listBookings(admin.cookie)).body as AdminBookingListResponse;

    const stored = await prisma.booking.findMany({ select: { id: true } });
    expect(body.bookings.map((b) => b.id).sort()).toEqual(stored.map((b) => b.id).sort());
  });

  it('SYS-AC-09: студент отримує 403, гість — 401; студент не бачить поля student у власному списку', async () => {
    const student = await registerStudent(app);
    await bookingFor(student.userId, 'active', at(SLOT_START, 24 * 60));

    const asStudent = await listBookings(student.cookie);
    expect(asStudent.status).toBe(403);
    expect(errorBody(asStudent).code).toBe('FORBIDDEN');

    const asGuest = await listBookings(null);
    expect(asGuest.status).toBe(401);
    expect(errorBody(asGuest).code).toBe('UNAUTHENTICATED');

    const ownList = await request(app).get('/api/bookings?scope=upcoming').set('Cookie', student.cookie);
    expect(ownList.status).toBe(200);
    const bookings = (ownList.body as BookingListResponse).bookings;
    expect(bookings.length).toBeGreaterThan(0);
    for (const booking of bookings) expect(Object.keys(booking)).not.toContain('student');
  });
});

// Моменти рівно на початку слота й рівно в дедлайн не перевіряються (Q01, checkin_admin_flow.md,
// рішення 4); перевіряємо час строго до й строго після дедлайну (IN_GRACE, AFTER_DEADLINE, BEFORE_START).
describe('POST /api/admin/bookings/:bookingId/confirm', () => {
  useClock(IN_GRACE);

  it('US-A.7-AC-01: адміністратор підтверджує active у grace period — confirmed, confirmedBy: admin', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const booking = await bookingFor(student.userId);

    const res = await confirm(admin.cookie, booking.id);

    expect(res.status).toBe(200);
    const body = res.body as CheckInResult;
    expect(body.result).toBe('confirmed');
    expect(body.serverTime).toBe(IN_GRACE.toISOString());
    expect(body.booking).toMatchObject({
      id: booking.id,
      status: 'confirmed',
      confirmedAt: IN_GRACE.toISOString(),
      confirmedBy: 'admin',
      cancelledAt: null,
    });
    // Відповідь — Booking без даних власника (CheckInResult).
    expect(Object.keys(body.booking)).not.toContain('student');

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('confirmed');
    expect(stored.confirmedById).toBe(admin.userId);
    expect(stored.userId).toBe(student.userId);
  });

  it('US-A.7-AC-02 (SYS-AC-03): підтверджене адміністратором не автоскасовується після дедлайну', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const booking = await bookingFor(student.userId);
    expect((await confirm(admin.cookie, booking.id)).status).toBe(200);

    setClock(() => AFTER_DEADLINE);
    await cancelExpiredBookings(AFTER_DEADLINE);
    const body = (await listBookings(admin.cookie)).body as AdminBookingListResponse;

    expect(bookingIn(body, booking.id).status).toBe('confirmed');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('confirmed');
    expect(stored.cancelledAt).toBeNull();
  });

  it('US-A.7-AC-02 (Q06): повторне підтвердження — already_confirmed без змін', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const booking = await bookingFor(student.userId);
    expect((await confirm(admin.cookie, booking.id)).status).toBe(200);

    setClock(() => at(IN_GRACE, 3));
    const res = await confirm(admin.cookie, booking.id);

    expect(res.status).toBe(200);
    expect((res.body as CheckInResult).result).toBe('already_confirmed');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.confirmedAt?.toISOString()).toBe(IN_GRACE.toISOString());
  });

  it('US-A.7-AC-02 (Q06): підтверджене студентом — already_confirmed, confirmedById не змінюється', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const booking = await createBookingRow('confirmed', {
      slotId: (await createSlot((await createRoom()).id, SLOT_START)).id,
      userId: student.userId,
      confirmedById: student.userId,
    });

    const res = await confirm(admin.cookie, booking.id);

    expect(res.status).toBe(200);
    const body = res.body as CheckInResult;
    expect(body.result).toBe('already_confirmed');
    expect(body.booking.confirmedBy).toBe('student');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.confirmedById).toBe(student.userId);
  });

  it('US-A.7-AC-01: після дедлайну — 422 CHECK_IN_WINDOW_CLOSED, бронювання auto_cancelled', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const booking = await bookingFor(student.userId);
    setClock(() => AFTER_DEADLINE);

    const res = await confirm(admin.cookie, booking.id);

    expect(res.status).toBe(422);
    expect(errorBody(res).code).toBe('CHECK_IN_WINDOW_CLOSED');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('auto_cancelled');
    expect(stored.confirmedAt).toBeNull();
  });

  it('US-A.7-AC-03: автоскасоване не відновлюється — 422 CHECK_IN_WINDOW_CLOSED', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const booking = await bookingFor(student.userId, 'auto_cancelled');

    const res = await confirm(admin.cookie, booking.id);

    expect(res.status).toBe(422);
    expect(errorBody(res).code).toBe('CHECK_IN_WINDOW_CLOSED');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('auto_cancelled');
    expect(stored.confirmedAt).toBeNull();
  });

  it('US-A.7-AC-03: скасоване студентом — 409 BOOKING_STATUS_CONFLICT з currentStatus, статус не змінено', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const booking = await bookingFor(student.userId, 'cancelled_by_student');

    const res = await confirm(admin.cookie, booking.id);

    expect(res.status).toBe(409);
    expect(errorBody(res).code).toBe('BOOKING_STATUS_CONFLICT');
    expect(errorBody(res).details).toEqual({ currentStatus: 'cancelled_by_student' });
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('cancelled_by_student');
    expect(stored.confirmedAt).toBeNull();
    expect(stored.confirmedById).toBeNull();
  });

  it('US-A.7-AC-01 (Q01): до початку слота — 422 CHECK_IN_TOO_EARLY, статус active', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const booking = await bookingFor(student.userId);
    setClock(() => BEFORE_START);

    const res = await confirm(admin.cookie, booking.id);

    expect(res.status).toBe(422);
    expect(errorBody(res).code).toBe('CHECK_IN_TOO_EARLY');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('active');
    expect(stored.confirmedAt).toBeNull();
  });

  it('US-A.7-AC-01: неіснуюче бронювання — 404 BOOKING_NOT_FOUND, не UUID — 400 VALIDATION_ERROR', async () => {
    const admin = await adminSession(app);

    const missing = await confirm(admin.cookie, MISSING_BOOKING_ID);
    expect(missing.status).toBe(404);
    expect(errorBody(missing).code).toBe('BOOKING_NOT_FOUND');

    const badId = await confirm(admin.cookie, 'not-a-uuid');
    expect(badId.status).toBe(400);
    expect(errorBody(badId).code).toBe('VALIDATION_ERROR');
    const fields = errorBody(badId).details?.fields as { path: string }[];
    expect(fields.map((field) => field.path)).toContain('params.bookingId');
  });

  it('SYS-AC-09: студент не підтверджує вручну — 403, гість — 401, стан БД не змінено', async () => {
    const student = await registerStudent(app);
    const booking = await bookingFor(student.userId);

    const asStudent = await confirm(student.cookie, booking.id);
    expect(asStudent.status).toBe(403);
    expect(errorBody(asStudent).code).toBe('FORBIDDEN');

    const asGuest = await confirm(null, booking.id);
    expect(asGuest.status).toBe(401);

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('active');
    expect(stored.confirmedAt).toBeNull();
    expect(stored.confirmedById).toBeNull();
  });
});

describe('SYS-AC-07: ручне підтвердження й автоскасування на реальній БД', () => {
  useClock(IN_GRACE);

  it('SYS-AC-07: автоскасування виграло — підтвердження відповідає CHECK_IN_WINDOW_CLOSED і не відновлює запис', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const booking = await bookingFor(student.userId);

    // Фоновий таймер уже бачив момент після дедлайну, а запит адміністратора оброблено з моментом у вікні.
    expect(await cancelExpiredBookings(AFTER_DEADLINE)).toBeGreaterThanOrEqual(1);
    const result = confirmBooking(booking.id, admin.userId);

    await expect(result).rejects.toBeInstanceOf(AppError);
    await expect(result).rejects.toMatchObject({ code: 'CHECK_IN_WINDOW_CLOSED' });
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('auto_cancelled');
    expect(stored.confirmedAt).toBeNull();
  });

  it('SYS-AC-07: підтвердження виграло — автоскасування не переписує confirmed', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const booking = await bookingFor(student.userId);

    await confirmBooking(booking.id, admin.userId);
    await cancelExpiredBookings(AFTER_DEADLINE);

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('confirmed');
    expect(stored.cancelledAt).toBeNull();
  });

  it('SYS-AC-07: одночасні підтвердження й автоскасування — один узгоджений кінцевий стан, без SQLITE_BUSY', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const booking = await bookingFor(student.userId);

    const [confirmed, cancelled] = await Promise.allSettled([
      confirmBooking(booking.id, admin.userId),
      cancelExpiredBookings(AFTER_DEADLINE),
    ]);

    // Автоскасування — одне updateMany; воно не має падати (зокрема через SQLITE_BUSY).
    expect(cancelled.status).toBe('fulfilled');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    if (confirmed.status === 'fulfilled') {
      expect(confirmed.value.result).toBe('confirmed');
      expect(stored.status).toBe('confirmed');
      expect(stored.confirmedById).toBe(admin.userId);
      expect(stored.cancelledAt).toBeNull();
    } else {
      // Програна гонка — лише закрите вікно, а не інша помилка.
      expect(confirmed.reason).toBeInstanceOf(AppError);
      expect((confirmed.reason as AppError).code).toBe('CHECK_IN_WINDOW_CLOSED');
      expect(stored.status).toBe('auto_cancelled');
      expect(stored.confirmedAt).toBeNull();
    }
  });

  it('SYS-AC-07: паралельні ручні підтвердження одного бронювання — один confirmed, решта already_confirmed', async () => {
    const admin = await adminSession(app);
    const student = await newStudent();
    const booking = await bookingFor(student.userId);

    const results = await Promise.all(
      Array.from({ length: 4 }, () => confirmBooking(booking.id, admin.userId)),
    );

    expect(results.filter((r) => r.result === 'confirmed')).toHaveLength(1);
    expect(results.filter((r) => r.result === 'already_confirmed')).toHaveLength(3);
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('confirmed');
  });
});
