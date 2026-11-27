import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { BookingListResponse, BookingResponse, CheckInResult, ErrorBody } from '@roomly/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { AppError } from '../src/lib/appError';
import { setClock } from '../src/lib/clock';
import { cancelExpiredBookings } from '../src/modules/bookings/autoCancel';
import { confirmCurrentBooking } from '../src/modules/checkIns/checkIns.service';
import { adminSession, sessionCookieFrom } from './helpers/auth';
import { createBookingRow, createRoom, createSlot, createUser } from './helpers/factories';
import { at, useClock } from './helpers/time';

// Issue #50: тести підтвердження присутності з вимог (requirements.md §4: US-5.1, US-5.2, US-5.6a/b;
// SYS-AC-07) і api_spec.md §8, а не з коду. Матрицю «AC → тест» затверджено до написання тестів
// (prompts/6.2_test_generation.md). Тести авторів коду (checkIns.test.ts) не використовуються.
//
// Слот о 10:00–11:00 за Києвом, дедлайн 10:15 (H01). Моменти рівно на початку слота й рівно в дедлайн
// не перевіряються (Q01, checkin_admin_flow.md, рішення 4): лише щонайменше за хвилину до чи після.

const app = createApp();

const SLOT_START = '2026-11-03T08:00:00.000Z';
const DEADLINE = at(SLOT_START, 15);
const IN_GRACE = at(SLOT_START, 5); // 10:05
const LATE_IN_GRACE = at(SLOT_START, 14); // 10:14
const AFTER_DEADLINE = at(SLOT_START, 16); // 10:16
const HOURS_BEFORE = at(SLOT_START, -180); // 07:00

// Студент із сесією: користувач напряму в БД і справжній вхід через API (як adminSession).
async function studentSession(name = 'Студент') {
  const user = await createUser({ name });
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
  expect(res.status).toBe(200);
  return { cookie: sessionCookieFrom(res), userId: user.id, email: user.email };
}

// Власна кімната з поточним слотом і бронюванням власника в заданому статусі.
async function roomWithBooking(
  ownerId: string,
  status: 'active' | 'confirmed' | 'cancelled_by_student' | 'auto_cancelled' = 'active',
) {
  const room = await createRoom();
  const slot = await createSlot(room.id, SLOT_START);
  const booking = await createBookingRow(status, { slotId: slot.id, userId: ownerId });
  return { room, slot, booking };
}

function scan(cookie: string | null, body: object) {
  const req = request(app).post('/api/check-ins');
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
}

function errorOf(res: request.Response) {
  return (res.body as ErrorBody).error;
}

async function stored(bookingId: string) {
  return prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
}

describe('US-5.1: підтвердження власником за QR', () => {
  useClock(IN_GRACE);

  it('US-5.1-AC-01: власник сканує QR своєї кімнати о 10:05 — бронювання підтверджене', async () => {
    const owner = await studentSession();
    const { room, booking } = await roomWithBooking(owner.userId);

    const res = await scan(owner.cookie, { qrToken: room.qrToken });

    expect(res.status).toBe(200);
    const body = res.body as CheckInResult;
    expect(body.result).toBe('confirmed');
    expect(body.booking).toMatchObject({ id: booking.id, status: 'confirmed', confirmedBy: 'student' });
    const row = await stored(booking.id);
    expect(row.status).toBe('confirmed');
    expect(row.confirmedAt?.toISOString()).toBe(IN_GRACE.toISOString());
    expect(row.confirmedById).toBe(owner.userId);
  });

  it('US-5.1-AC-01 (S02): скан за хвилину до дедлайну (10:14) підтверджує бронювання', async () => {
    const owner = await studentSession();
    const { room, booking } = await roomWithBooking(owner.userId);
    setClock(() => LATE_IN_GRACE);

    const res = await scan(owner.cookie, { qrToken: room.qrToken });

    expect(res.status).toBe(200);
    expect((res.body as CheckInResult).result).toBe('confirmed');
    expect((await stored(booking.id)).status).toBe('confirmed');
  });

  it('US-5.1-AC-02: підтверджене бронювання не автоскасовується після дедлайну', async () => {
    const owner = await studentSession();
    const { room, booking } = await roomWithBooking(owner.userId);
    expect((await scan(owner.cookie, { qrToken: room.qrToken })).status).toBe(200);

    setClock(() => AFTER_DEADLINE);
    await cancelExpiredBookings(AFTER_DEADLINE);
    const list = await request(app).get('/api/bookings?scope=past').set('Cookie', owner.cookie);

    expect(list.status).toBe(200);
    const shown = (list.body as BookingListResponse).bookings.filter((b) => b.id === booking.id);
    expect(shown.map((b) => b.status)).toEqual(['confirmed']);
    const row = await stored(booking.id);
    expect(row.status).toBe('confirmed');
    expect(row.cancelledAt).toBeNull();
  });

  it('US-5.1-AC-03: невідомий QR — 422 QR_UNKNOWN, бронювання сканера лишається active', async () => {
    const owner = await studentSession();
    const { booking } = await roomWithBooking(owner.userId);

    const res = await scan(owner.cookie, { qrToken: `unknown-${booking.id}` });

    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('QR_UNKNOWN');
    const row = await stored(booking.id);
    expect(row.status).toBe('active');
    expect(row.confirmedAt).toBeNull();
  });

  it.each([
    ['порожній', { qrToken: '' }],
    ['відсутній', {}],
  ])('US-5.1-AC-03: %s qrToken — 400 VALIDATION_ERROR, статус не змінено', async (_name, body) => {
    const owner = await studentSession();
    const { booking } = await roomWithBooking(owner.userId);

    const res = await scan(owner.cookie, body);

    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    const fields = errorOf(res).details?.fields as { path: string }[];
    expect(fields.map((field) => field.path)).toContain('qrToken');
    expect((await stored(booking.id)).status).toBe('active');
  });

  it('US-5.1-AC-04 (S04): кімната без бронювань — NO_CURRENT_BOOKING, нового не створено, бронювання іншої кімнати active', async () => {
    const scanner = await studentSession();
    const empty = await createRoom();
    const other = await roomWithBooking((await createUser()).id);

    const res = await scan(scanner.cookie, { qrToken: empty.qrToken });

    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('NO_CURRENT_BOOKING');
    expect(await prisma.booking.count({ where: { slot: { roomId: empty.id } } })).toBe(0);
    expect((await stored(other.booking.id)).status).toBe('active');
  });

  it('US-5.1-AC-04 (api_spec §8): поточне бронювання скасоване студентом — NO_CURRENT_BOOKING, не відновлено', async () => {
    const scanner = await studentSession();
    const { room, slot, booking } = await roomWithBooking((await createUser()).id, 'cancelled_by_student');

    const res = await scan(scanner.cookie, { qrToken: room.qrToken });

    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('NO_CURRENT_BOOKING');
    expect((await stored(booking.id)).status).toBe('cancelled_by_student');
    expect(await prisma.booking.count({ where: { slotId: slot.id } })).toBe(1);
  });

  it('US-5.1-AC-01 (рішення 4): скан за три години до початку — CHECK_IN_TOO_EARLY, статус active', async () => {
    const owner = await studentSession();
    const { room, booking } = await roomWithBooking(owner.userId);
    setClock(() => HOURS_BEFORE);

    const res = await scan(owner.cookie, { qrToken: room.qrToken });

    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('CHECK_IN_TOO_EARLY');
    const row = await stored(booking.id);
    expect(row.status).toBe('active');
    expect(row.confirmedAt).toBeNull();
  });

  it('US-5.1-AC-05 (S05): повторний скан о 10:07 — already_confirmed, confirmedAt не змінено, бронювання одне', async () => {
    const owner = await studentSession();
    const { room, slot, booking } = await roomWithBooking(owner.userId);
    expect((await scan(owner.cookie, { qrToken: room.qrToken })).status).toBe(200);

    setClock(() => at(SLOT_START, 7));
    const res = await scan(owner.cookie, { qrToken: room.qrToken });

    expect(res.status).toBe(200);
    expect((res.body as CheckInResult).result).toBe('already_confirmed');
    const row = await stored(booking.id);
    expect(row.status).toBe('confirmed');
    expect(row.confirmedAt?.toISOString()).toBe(IN_GRACE.toISOString());
    expect(await prisma.booking.count({ where: { slotId: slot.id } })).toBe(1);
  });

  it('US-5.1-AC-06 (S06): скан після автоскасування — CHECK_IN_WINDOW_CLOSED, запис не відновлено, нового немає', async () => {
    const owner = await studentSession();
    const { room, slot, booking } = await roomWithBooking(owner.userId, 'auto_cancelled');
    setClock(() => AFTER_DEADLINE);

    const res = await scan(owner.cookie, { qrToken: room.qrToken });

    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('CHECK_IN_WINDOW_CLOSED');
    const row = await stored(booking.id);
    expect(row.status).toBe('auto_cancelled');
    expect(row.confirmedAt).toBeNull();
    expect(await prisma.booking.count({ where: { slotId: slot.id } })).toBe(1);
  });

  it('US-5.1-AC-06: active після дедлайну до спрацювання таймера — CHECK_IN_WINDOW_CLOSED, у БД auto_cancelled', async () => {
    const owner = await studentSession();
    const { room, booking } = await roomWithBooking(owner.userId);
    setClock(() => AFTER_DEADLINE);

    const res = await scan(owner.cookie, { qrToken: room.qrToken });

    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('CHECK_IN_WINDOW_CLOSED');
    const row = await stored(booking.id);
    expect(row.status).toBe('auto_cancelled');
    expect(row.confirmedAt).toBeNull();
  });
});

describe('US-5.2: підтвердження іншим студентом', () => {
  useClock(IN_GRACE);

  it('US-5.2-AC-01, US-5.2-AC-04 (S01): інший студент підтверджує, власник не змінюється, даних власника у відповіді немає', async () => {
    const olena = await createUser({ name: 'Олена' });
    const bohdan = await studentSession('Богдан');
    const { room, booking } = await roomWithBooking(olena.id);

    const res = await scan(bohdan.cookie, { qrToken: room.qrToken });

    expect(res.status).toBe(200);
    expect((res.body as CheckInResult).result).toBe('confirmed');
    expect((res.body as CheckInResult).booking.confirmedBy).toBe('student');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(olena.id);
    expect(text).not.toContain(olena.email);
    const row = await stored(booking.id);
    expect(row.status).toBe('confirmed');
    expect(row.userId).toBe(olena.id);
    expect(row.confirmedById).toBe(bohdan.userId);
  });

  it('US-5.2-AC-04: той, хто підтвердив, не бачить і не скасовує чуже бронювання — BOOKING_NOT_FOUND', async () => {
    const olena = await createUser({ name: 'Олена' });
    const bohdan = await studentSession('Богдан');
    const { room, booking } = await roomWithBooking(olena.id);
    expect((await scan(bohdan.cookie, { qrToken: room.qrToken })).status).toBe(200);

    const details = await request(app).get(`/api/bookings/${booking.id}`).set('Cookie', bohdan.cookie);
    const cancel = await request(app)
      .post(`/api/bookings/${booking.id}/cancel`)
      .set('Cookie', bohdan.cookie)
      .send({});

    expect(details.status).toBe(404);
    expect(errorOf(details).code).toBe('BOOKING_NOT_FOUND');
    expect(cancel.status).toBe(404);
    expect(errorOf(cancel).code).toBe('BOOKING_NOT_FOUND');
    const row = await stored(booking.id);
    expect(row.status).toBe('confirmed');
    expect(row.userId).toBe(olena.id);
  });

  it('US-5.2-AC-02 (S02): QR іншої кімнати підтверджує її бронювання, а не власне бронювання сканера', async () => {
    const bohdan = await studentSession('Богдан');
    const olena = await createUser({ name: 'Олена' });
    const own = await roomWithBooking(bohdan.userId);
    const other = await roomWithBooking(olena.id);

    const res = await scan(bohdan.cookie, { qrToken: other.room.qrToken });

    expect(res.status).toBe(200);
    expect((res.body as CheckInResult).booking.id).toBe(other.booking.id);
    expect((await stored(other.booking.id)).status).toBe('confirmed');
    const ownRow = await stored(own.booking.id);
    expect(ownRow.status).toBe('active');
    expect(ownRow.confirmedAt).toBeNull();
  });

  it('US-5.2-AC-03 (S03): скан без входу — 401 UNAUTHENTICATED, бронювання active', async () => {
    const { room, booking } = await roomWithBooking((await createUser()).id);

    const res = await scan(null, { qrToken: room.qrToken });

    expect(res.status).toBe(401);
    expect(errorOf(res).code).toBe('UNAUTHENTICATED');
    expect((await stored(booking.id)).status).toBe('active');
  });

  it('US-5.2-AC-01 (api_spec §8): адміністратор не сканує QR — 403 FORBIDDEN, бронювання active', async () => {
    const admin = await adminSession(app);
    const { room, booking } = await roomWithBooking((await createUser()).id);

    const res = await scan(admin.cookie, { qrToken: room.qrToken });

    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('FORBIDDEN');
    const row = await stored(booking.id);
    expect(row.status).toBe('active');
    expect(row.confirmedById).toBeNull();
  });
});

describe('US-5.6a, US-5.6b: мережа й повтор (серверна частина)', () => {
  useClock(IN_GRACE);

  it('US-5.6b-AC-01, US-5.6b-AC-02 (S01): після невдалої спроби повтор о 10:08 підтверджує те саме бронювання', async () => {
    const owner = await studentSession();
    const { room, slot, booking } = await roomWithBooking(owner.userId);
    // Невдала спроба: запит не дійшов із правильним вмістом (сервер відхилив невідомий токен).
    expect((await scan(owner.cookie, { qrToken: `broken-${booking.id}` })).status).toBe(422);

    setClock(() => at(SLOT_START, 8));
    const res = await scan(owner.cookie, { qrToken: room.qrToken });

    expect(res.status).toBe(200);
    expect((res.body as CheckInResult).result).toBe('confirmed');
    expect((res.body as CheckInResult).booking.id).toBe(booking.id);
    expect((await stored(booking.id)).status).toBe('confirmed');
    expect(await prisma.booking.count({ where: { slotId: slot.id } })).toBe(1);
  });

  it('US-5.6b-AC-03 (S02): повтор після автоскасування — CHECK_IN_WINDOW_CLOSED, дедлайн не продовжено', async () => {
    const owner = await studentSession();
    const { room, booking } = await roomWithBooking(owner.userId, 'auto_cancelled');
    setClock(() => AFTER_DEADLINE);

    const res = await scan(owner.cookie, { qrToken: room.qrToken });

    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('CHECK_IN_WINDOW_CLOSED');
    const row = await stored(booking.id);
    expect(row.status).toBe('auto_cancelled');
    expect(row.deadline.toISOString()).toBe(DEADLINE.toISOString());
  });

  it('US-5.6a-AC-02: без надісланого підтвердження ні автоскасування о 10:14, ні читання не змінюють статус active', async () => {
    const owner = await studentSession();
    const { booking } = await roomWithBooking(owner.userId);
    setClock(() => LATE_IN_GRACE);

    // Дії, що могли б змінити статус без підтвердження: фонове автоскасування в межах вікна й ліниве
    // автоскасування, яке виконується перед кожним читанням бронювань (api_spec.md §1).
    await cancelExpiredBookings(LATE_IN_GRACE);
    for (let i = 0; i < 3; i += 1) {
      const list = await request(app).get('/api/bookings?scope=past').set('Cookie', owner.cookie);
      expect(list.status).toBe(200);
      const shown = (list.body as BookingListResponse).bookings.filter((b) => b.id === booking.id);
      expect(shown.map((b) => b.status)).toEqual(['active']);

      const details = await request(app).get(`/api/bookings/${booking.id}`).set('Cookie', owner.cookie);
      expect(details.status).toBe(200);
      expect((details.body as BookingResponse).booking).toMatchObject({
        status: 'active',
        confirmedAt: null,
        deadline: DEADLINE.toISOString(),
      });
    }

    const row = await stored(booking.id);
    expect(row.status).toBe('active');
    expect(row.confirmedAt).toBeNull();
    expect(row.confirmedById).toBeNull();
    expect(row.cancelledAt).toBeNull();
    expect(row.deadline.toISOString()).toBe(DEADLINE.toISOString());
  });

  it('US-5.6a-AC-03: невдала спроба не продовжує дедлайн — після 10:15 бронювання автоскасовується', async () => {
    const owner = await studentSession();
    const { booking } = await roomWithBooking(owner.userId);
    expect((await scan(owner.cookie, { qrToken: `broken-${booking.id}` })).status).toBe(422);

    expect((await stored(booking.id)).deadline.toISOString()).toBe(DEADLINE.toISOString());
    await cancelExpiredBookings(AFTER_DEADLINE);

    const row = await stored(booking.id);
    expect(row.status).toBe('auto_cancelled');
    expect(row.deadline.toISOString()).toBe(DEADLINE.toISOString());
  });
});

describe('SYS-AC-07: конкурентне підтвердження й автоскасування на реальній БД', () => {
  useClock(IN_GRACE);

  // Порядок виконання в Promise.all не гарантований, тому тест перевіряє лише узгодженість кінцевого стану
  // (confirmed або auto_cancelled, без суміші), а не те, хто виграв. Хто виграв, фіксують детерміновані
  // тести гонок нижче. Кілька ітерацій із власними даними підвищують шанс побачити обидва виходи;
  // кожна ітерація сама перевіряє узгодженість відповіді й БД, тож тест не залежить від того, який вихід випав.
  it('SYS-AC-07: одночасні check-in о 10:05 і автоскасування з моментом 10:16 — кінець один із двох узгоджених станів, без суміші', async () => {
    const ITERATIONS = 4;
    for (let i = 0; i < ITERATIONS; i += 1) {
      const owner = await studentSession();
      const { room, booking } = await roomWithBooking(owner.userId);

      const [checkIn, autoCancel] = await Promise.allSettled([
        scan(owner.cookie, { qrToken: room.qrToken }).then((res) => res),
        cancelExpiredBookings(AFTER_DEADLINE),
      ]);

      expect(autoCancel.status, `ітерація ${i}`).toBe('fulfilled');
      expect(checkIn.status, `ітерація ${i}`).toBe('fulfilled');
      if (checkIn.status !== 'fulfilled') throw new Error(`Ітерація ${i}: запит check-in не виконався`);
      const row = await stored(booking.id);
      if (checkIn.value.status === 200) {
        expect((checkIn.value.body as CheckInResult).result, `ітерація ${i}`).toBe('confirmed');
        expect(row.status, `ітерація ${i}`).toBe('confirmed');
        expect(row.cancelledAt, `ітерація ${i}`).toBeNull();
      } else {
        expect(checkIn.value.status, `ітерація ${i}`).toBe(422);
        expect(errorOf(checkIn.value).code, `ітерація ${i}`).toBe('CHECK_IN_WINDOW_CLOSED');
        expect(row.status, `ітерація ${i}`).toBe('auto_cancelled');
        expect(row.confirmedAt, `ітерація ${i}`).toBeNull();
      }
    }
  });

  // Детермінований варіант програної гонки: фоновий таймер уже бачив 10:16 і скасував запис, а скан
  // оброблено з моментом 10:05 (у вікні). Автоскасований запис не підтверджується й не відновлюється.
  it('SYS-AC-07, US-5.1-AC-06: автоскасування виграло — скан у межах вікна дає CHECK_IN_WINDOW_CLOSED, запис auto_cancelled', async () => {
    const owner = await studentSession();
    const { room, booking } = await roomWithBooking(owner.userId);
    await cancelExpiredBookings(AFTER_DEADLINE);

    const res = await scan(owner.cookie, { qrToken: room.qrToken });

    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('CHECK_IN_WINDOW_CLOSED');
    const row = await stored(booking.id);
    expect(row.status).toBe('auto_cancelled');
    expect(row.confirmedAt).toBeNull();
    expect(row.confirmedById).toBeNull();
  });

  // Гілки перечитування після програної гонки (ШІ-рев'ю PR #67): спершу справжній запис у БД,
  // потім виклик confirmCurrentBooking — без підміни Prisma.
  it('SYS-AC-07, US-5.1-AC-04: скасування студентом виграло гонку — NO_CURRENT_BOOKING, статус cancelled_by_student', async () => {
    const scanner = await createUser();
    const { booking } = await roomWithBooking((await createUser()).id);
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'cancelled_by_student', cancelledAt: IN_GRACE },
    });

    const result = confirmCurrentBooking(booking.id, scanner.id, IN_GRACE);

    await expect(result).rejects.toBeInstanceOf(AppError);
    await expect(result).rejects.toMatchObject({ code: 'NO_CURRENT_BOOKING' });
    const row = await stored(booking.id);
    expect(row.status).toBe('cancelled_by_student');
    expect(row.confirmedAt).toBeNull();
  });

  it('SYS-AC-07, US-5.1-AC-06: active із минулим дедлайном (10:16) — CHECK_IN_WINDOW_CLOSED, статус не змінено', async () => {
    const scanner = await createUser();
    const { booking } = await roomWithBooking((await createUser()).id);

    const result = confirmCurrentBooking(booking.id, scanner.id, AFTER_DEADLINE);

    await expect(result).rejects.toBeInstanceOf(AppError);
    await expect(result).rejects.toMatchObject({ code: 'CHECK_IN_WINDOW_CLOSED' });
    const row = await stored(booking.id);
    expect(row.status).toBe('active');
    expect(row.confirmedAt).toBeNull();
  });

  it('SYS-AC-07, US-5.6b-AC-03: active, що ще не почалося (07:00) — CHECK_IN_TOO_EARLY, статус не змінено', async () => {
    const scanner = await createUser();
    const { booking } = await roomWithBooking((await createUser()).id);

    const result = confirmCurrentBooking(booking.id, scanner.id, HOURS_BEFORE);

    await expect(result).rejects.toBeInstanceOf(AppError);
    await expect(result).rejects.toMatchObject({ code: 'CHECK_IN_TOO_EARLY' });
    const row = await stored(booking.id);
    expect(row.status).toBe('active');
    expect(row.confirmedAt).toBeNull();
  });
});
