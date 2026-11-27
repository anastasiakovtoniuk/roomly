import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type {
  AdminBookingListResponse,
  AvailableSlotListResponse,
  BookingListResponse,
  CheckInResult,
  ErrorBody,
  MeResponse,
  QrTokenResponse,
  RoomListResponse,
  RoomResponse,
  SlotResponse,
} from '@roomly/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { setClock } from '../src/lib/clock';
import { adminSession, sessionCookieFrom } from './helpers/auth';
import { createBookingRow, createRoom, createSlot, createUser } from './helpers/factories';
import { at, useClock } from './helpers/time';

// Issue #51: тести адмін-API з вимог (requirements.md §4, SYS-AC-08…09) і api_spec.md §9, а не з коду.
// Перелік «AC → тест» складено до читання реалізації (prompts/6.2_test_generation.md).
// Без очікувань для адмін-скасування (Q03/Q18) і для моменту рівно в дедлайн (Q01).
// US-A.5-AC-03 («порожній список») не автоматизується: спільна test.db не очищується (ADR-0008),
// тож буквально порожнього списку тут не буває — це ручний пункт SM-01 smoke-чекліста (#53).

const app = createApp();

// Слот о 10:00 за Києвом; дедлайн — початок + grace period (15 хв, H01) за createBookingRow.
const SLOT_START = '2026-11-03T08:00:00.000Z';
const IN_GRACE = at(SLOT_START, 5);
const AFTER_DEADLINE = at(SLOT_START, 16);
// Слоти, які створює адміністратор: завтра, 12:00–13:00 за Києвом.
const TOMORROW = '2026-11-04';
const NEW_SLOT = { startsAt: '2026-11-04T10:00:00.000Z', endsAt: '2026-11-04T11:00:00.000Z' };

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

useClock(IN_GRACE);

function error(res: request.Response) {
  return (res.body as ErrorBody).error;
}

function fieldPaths(res: request.Response): string[] {
  const fields = error(res).details?.fields as { path: string }[] | undefined;
  return (fields ?? []).map((field) => field.path);
}

// Запит із cookie сесії або без неї (гість). Тіла запитів зі зміною даних — JSON, інакше requireJson
// відповів би VALIDATION_ERROR раніше за перевірку ролі.
function call(method: 'get' | 'post' | 'patch', path: string, cookie: string | null, body?: object) {
  const req = request(app)[method](path);
  if (cookie) req.set('Cookie', cookie);
  return method === 'get' ? req : req.send(body ?? {});
}

// Студент напряму в БД (bcrypt cost 4) і справжній вхід через API: швидше за реєстрацію.
async function studentSession(name = 'Олена') {
  const user = await createUser({ name });
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
  expect(res.status).toBe(200);
  return { cookie: sessionCookieFrom(res), userId: user.id, email: user.email, name };
}

function roomBody(overrides: Record<string, unknown> = {}) {
  return {
    name: `R303 ${randomUUID()}`,
    capacity: 6,
    building: 'Б',
    floor: 2,
    equipment: ['екран', 'дошка'],
    ...overrides,
  };
}

async function roomInDb(roomId: string) {
  return prisma.room.findUniqueOrThrow({ where: { id: roomId } });
}

// Бронювання на поточному слоті власної кімнати: годинник тестів — у grace period цього слота.
// `GET /api/bookings` показує його в `past`, бо слот уже почався (рішення команди від 13.11.2026).
async function currentBooking(status: Parameters<typeof createBookingRow>[0] = 'active', userId?: string) {
  const room = await createRoom();
  const slot = await createSlot(room.id, SLOT_START);
  const booking = await createBookingRow(status, { slotId: slot.id, ...(userId ? { userId } : {}) });
  return { room, slot, booking };
}

describe('US-A.1a — створення кімнати', () => {
  it('US-A.1a-AC-01: адміністратор створює кімнату з місцями, корпусом, поверхом і обладнанням', async () => {
    const admin = await adminSession(app);
    const body = roomBody();

    const res = await call('post', '/api/admin/rooms', admin.cookie, body);

    expect(res.status).toBe(201);
    const { room } = res.body as RoomResponse;
    expect(room).toEqual({ id: expect.any(String), ...body });
    const saved = await roomInDb(room.id);
    expect(saved).toMatchObject({ name: body.name, capacity: 6, building: 'Б', floor: 2 });
    expect(JSON.parse(saved.equipment)).toEqual(['екран', 'дошка']);
    expect(saved.qrToken.length).toBeGreaterThan(0);
  });

  it('US-A.1a-AC-02: студент при наступному завантаженні бачить кімнату з тими самими даними, без токена QR', async () => {
    const admin = await adminSession(app);
    const student = await studentSession();
    const body = roomBody();
    const created = (await call('post', '/api/admin/rooms', admin.cookie, body)).body as RoomResponse;
    const { qrToken } = await roomInDb(created.room.id);

    const res = await call('get', '/api/rooms', student.cookie);

    expect(res.status).toBe(200);
    const listed = (res.body as RoomListResponse).rooms.find((room) => room.id === created.room.id);
    expect(listed).toEqual({ id: created.room.id, ...body });
    expect(JSON.stringify(res.body)).not.toContain(qrToken);
  });

  it('US-A.1a-AC-03: студентська роль не створює кімнату — 403 FORBIDDEN, запису немає', async () => {
    const student = await studentSession();
    const body = roomBody();

    const res = await call('post', '/api/admin/rooms', student.cookie, body);

    expect(res.status).toBe(403);
    expect(error(res).code).toBe('FORBIDDEN');
    expect(await prisma.room.count({ where: { name: body.name } })).toBe(0);
  });

  it('US-A.1a-AC-03: невалідне тіло — 400 VALIDATION_ERROR з details.fields, кімнату не створено', async () => {
    const admin = await adminSession(app);
    const { building: _omitted, ...body } = roomBody({ capacity: 0 });

    const res = await call('post', '/api/admin/rooms', admin.cookie, body);

    expect(res.status).toBe(400);
    expect(error(res).code).toBe('VALIDATION_ERROR');
    expect(fieldPaths(res)).toEqual(expect.arrayContaining(['capacity', 'building']));
    expect(await prisma.room.count({ where: { name: body.name } })).toBe(0);
  });
});

describe('US-A.1b — редагування кімнати', () => {
  it('US-A.1b-AC-01, AC-02: збережені зміни всіх полів бачить студент', async () => {
    const admin = await adminSession(app);
    const student = await studentSession();
    const room = await createRoom({ capacity: 4, building: 'А', floor: 1, equipment: ['дошка'] });
    const changes = { capacity: 6, building: 'Б', floor: 2, equipment: ['екран', 'дошка'] };

    const res = await call('patch', `/api/admin/rooms/${room.id}`, admin.cookie, changes);

    expect(res.status).toBe(200);
    expect((res.body as RoomResponse).room).toEqual({ id: room.id, name: room.name, ...changes });
    const seen = await call('get', `/api/rooms/${room.id}`, student.cookie);
    expect((seen.body as RoomResponse).room).toEqual({ id: room.id, name: room.name, ...changes });
  });

  it('US-A.1b-AC-03: зміна лише місткості не змінює решту полів і токен, другої кімнати немає', async () => {
    const admin = await adminSession(app);
    const room = await createRoom({ capacity: 4, building: 'А', floor: 1, equipment: ['дошка'] });
    const roomsBefore = await prisma.room.count();

    const res = await call('patch', `/api/admin/rooms/${room.id}`, admin.cookie, { capacity: 6 });

    expect(res.status).toBe(200);
    const saved = await roomInDb(room.id);
    expect(saved).toMatchObject({
      name: room.name,
      capacity: 6,
      building: 'А',
      floor: 1,
      qrToken: room.qrToken,
    });
    expect(JSON.parse(saved.equipment)).toEqual(['дошка']);
    expect(await prisma.room.count()).toBe(roomsBefore);
    expect(await prisma.room.count({ where: { name: room.name } })).toBe(1);
  });

  it('US-A.1b-AC-03: порожнє тіло — 400 VALIDATION_ERROR з details.fields, кімната без змін', async () => {
    const admin = await adminSession(app);
    const room = await createRoom({ capacity: 4 });

    const res = await call('patch', `/api/admin/rooms/${room.id}`, admin.cookie, {});

    expect(res.status).toBe(400);
    expect(error(res).code).toBe('VALIDATION_ERROR');
    // Правило «хоча б одне поле» стосується тіла цілком: шлях `body`, reason — код Zod (error_format.md §1).
    expect(error(res).details?.fields).toEqual([{ path: 'body', reason: 'custom' }]);
    expect((await roomInDb(room.id)).capacity).toBe(4);
  });

  it('US-A.1b-AC-01: неіснуюча кімната — 404 ROOM_NOT_FOUND, нової кімнати не створено', async () => {
    const admin = await adminSession(app);
    const roomsBefore = await prisma.room.count();

    const res = await call('patch', `/api/admin/rooms/${MISSING_ID}`, admin.cookie, { capacity: 6 });

    expect(res.status).toBe(404);
    expect(error(res).code).toBe('ROOM_NOT_FOUND');
    expect(await prisma.room.count()).toBe(roomsBefore);
  });
});

describe('US-A.2 — створення слотів', () => {
  it('US-A.2-AC-01, AC-02: слот збережено, і студент бачить його серед вільних на цю дату', async () => {
    const admin = await adminSession(app);
    const student = await studentSession();
    const room = await createRoom();

    const res = await call('post', `/api/admin/rooms/${room.id}/slots`, admin.cookie, NEW_SLOT);

    expect(res.status).toBe(201);
    const { slot } = res.body as SlotResponse;
    expect(slot).toEqual({ id: expect.any(String), roomId: room.id, ...NEW_SLOT });
    expect(await prisma.slot.count({ where: { id: slot.id, roomId: room.id } })).toBe(1);
    const available = await call(
      'get',
      `/api/rooms/${room.id}/available-slots?date=${TOMORROW}`,
      student.cookie,
    );
    expect(available.status).toBe(200);
    expect((available.body as AvailableSlotListResponse).slots.map((s) => s.id)).toEqual([slot.id]);
  });

  it.each([
    ['дорівнює початку', NEW_SLOT.startsAt],
    ['раніше за початок', '2026-11-04T09:00:00.000Z'],
  ])('US-A.2-AC-01: кінець %s — 400 VALIDATION_ERROR, слота немає', async (_case, endsAt) => {
    const admin = await adminSession(app);
    const room = await createRoom();

    const res = await call('post', `/api/admin/rooms/${room.id}/slots`, admin.cookie, {
      startsAt: NEW_SLOT.startsAt,
      endsAt,
    });

    expect(res.status).toBe(400);
    expect(error(res).code).toBe('VALIDATION_ERROR');
    expect(fieldPaths(res)).toContain('endsAt');
    expect(await prisma.slot.count({ where: { roomId: room.id } })).toBe(0);
  });

  it('US-A.2-AC-01: слот, що перетинається з наявним, — 409 SLOT_OVERLAP, нового слота немає', async () => {
    const admin = await adminSession(app);
    const room = await createRoom();
    await createSlot(room.id, NEW_SLOT.startsAt);

    const res = await call('post', `/api/admin/rooms/${room.id}/slots`, admin.cookie, {
      startsAt: '2026-11-04T10:30:00.000Z',
      endsAt: '2026-11-04T11:30:00.000Z',
    });

    expect(res.status).toBe(409);
    expect(error(res).code).toBe('SLOT_OVERLAP');
    expect(await prisma.slot.count({ where: { roomId: room.id } })).toBe(1);
  });

  it('US-A.2-AC-03: студент не створює слот — 403 FORBIDDEN, слота немає', async () => {
    const student = await studentSession();
    const room = await createRoom();

    const res = await call('post', `/api/admin/rooms/${room.id}/slots`, student.cookie, NEW_SLOT);

    expect(res.status).toBe(403);
    expect(error(res).code).toBe('FORBIDDEN');
    expect(await prisma.slot.count({ where: { roomId: room.id } })).toBe(0);
  });
});

describe('US-A.4a, US-A.4b — QR кімнати', () => {
  it('US-A.4a-AC-01, AC-02: токен кімнати без бронювань належить саме їй, повтор — той самий', async () => {
    const admin = await adminSession(app);
    const room = await createRoom();
    expect(await prisma.booking.count({ where: { slot: { roomId: room.id } } })).toBe(0);

    const first = await call('get', `/api/admin/rooms/${room.id}/qr`, admin.cookie);
    const second = await call('get', `/api/admin/rooms/${room.id}/qr`, admin.cookie);

    expect(first.status).toBe(200);
    expect(first.body as QrTokenResponse).toEqual({
      roomId: room.id,
      roomName: room.name,
      qrToken: room.qrToken,
    });
    expect((second.body as QrTokenResponse).qrToken).toBe(room.qrToken);
  });

  it('US-A.4a-AC-03: токени двох кімнат різні, і кожен підтверджує бронювання своєї кімнати', async () => {
    const admin = await adminSession(app);
    const student = await studentSession('Богдан');
    const a = await currentBooking();
    const b = await currentBooking();

    const tokenA = (
      (await call('get', `/api/admin/rooms/${a.room.id}/qr`, admin.cookie)).body as QrTokenResponse
    ).qrToken;
    const tokenB = (
      (await call('get', `/api/admin/rooms/${b.room.id}/qr`, admin.cookie)).body as QrTokenResponse
    ).qrToken;
    expect(tokenA).not.toBe(tokenB);

    const checkA = await call('post', '/api/check-ins', student.cookie, { qrToken: tokenA });
    const checkB = await call('post', '/api/check-ins', student.cookie, { qrToken: tokenB });

    expect((checkA.body as CheckInResult).booking).toMatchObject({
      id: a.booking.id,
      room: { id: a.room.id },
    });
    expect((checkB.body as CheckInResult).booking).toMatchObject({
      id: b.booking.id,
      room: { id: b.room.id },
    });
  });

  it('US-A.4b-AC-03: студент не отримує токен QR — 403 FORBIDDEN без значення токена', async () => {
    const student = await studentSession();
    const room = await createRoom();

    const res = await call('get', `/api/admin/rooms/${room.id}/qr`, student.cookie);

    expect(res.status).toBe(403);
    expect(error(res).code).toBe('FORBIDDEN');
    expect(JSON.stringify(res.body)).not.toContain(room.qrToken);
  });
});

describe('US-A.5 — усі бронювання зі статусами', () => {
  it('US-A.5-AC-01, AC-02: адміністратор бачить бронювання різних студентів, active і confirmed розрізняються', async () => {
    const admin = await adminSession(app);
    const olena = await createUser({ name: 'Олена' });
    const bohdan = await createUser({ name: 'Богдан' });
    const b1 = (await currentBooking('active', olena.id)).booking;
    const b2 = (await currentBooking('confirmed', bohdan.id)).booking;

    const res = await call('get', '/api/admin/bookings', admin.cookie);

    expect(res.status).toBe(200);
    const { bookings } = res.body as AdminBookingListResponse;
    expect(bookings.find((b) => b.id === b1.id)).toMatchObject({
      status: 'active',
      student: { id: olena.id, name: 'Олена', email: olena.email },
    });
    expect(bookings.find((b) => b.id === b2.id)).toMatchObject({
      status: 'confirmed',
      student: { id: bohdan.id, name: 'Богдан', email: bohdan.email },
    });
  });
});

describe('US-A.7 — ручне підтвердження адміністратором', () => {
  function confirm(cookie: string, bookingId: string) {
    return call('post', `/api/admin/bookings/${bookingId}/confirm`, cookie);
  }

  it('US-A.7-AC-01: у grace period без скану QR — confirmed, confirmedBy "admin"', async () => {
    const admin = await adminSession(app);
    const { booking } = await currentBooking();

    const res = await confirm(admin.cookie, booking.id);

    expect(res.status).toBe(200);
    const result = res.body as CheckInResult;
    expect(result.result).toBe('confirmed');
    expect(result.booking).toMatchObject({ id: booking.id, status: 'confirmed', confirmedBy: 'admin' });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('confirmed');
  });

  it('US-A.7-AC-02: підтверджене вручну не автоскасовується після дедлайну', async () => {
    const admin = await adminSession(app);
    const { booking } = await currentBooking();
    expect((await confirm(admin.cookie, booking.id)).status).toBe(200);

    setClock(() => AFTER_DEADLINE);
    // Список запускає ліниве автоскасування перед відповіддю (ADR-0006).
    const res = await call('get', '/api/admin/bookings', admin.cookie);

    expect((res.body as AdminBookingListResponse).bookings.find((b) => b.id === booking.id)?.status).toBe(
      'confirmed',
    );
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('confirmed');
  });

  it('US-A.7-AC-03: скасоване студентом не відновлюється — 409 BOOKING_STATUS_CONFLICT', async () => {
    const admin = await adminSession(app);
    const { booking } = await currentBooking('cancelled_by_student');

    const res = await confirm(admin.cookie, booking.id);

    expect(res.status).toBe(409);
    expect(error(res).code).toBe('BOOKING_STATUS_CONFLICT');
    expect(error(res).details).toMatchObject({ currentStatus: 'cancelled_by_student' });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      'cancelled_by_student',
    );
  });

  it('US-A.7-AC-03: автоскасоване не відновлюється — 422 CHECK_IN_WINDOW_CLOSED', async () => {
    const admin = await adminSession(app);
    const { booking } = await currentBooking('auto_cancelled');

    const res = await confirm(admin.cookie, booking.id);

    expect(res.status).toBe(422);
    expect(error(res).code).toBe('CHECK_IN_WINDOW_CLOSED');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      'auto_cancelled',
    );
  });

  it('US-A.7-AC-01: бронювання, що ще не почалося, — 422 CHECK_IN_TOO_EARLY, статус active', async () => {
    const admin = await adminSession(app);
    const room = await createRoom();
    const slot = await createSlot(room.id, at(SLOT_START, 60));
    const booking = await createBookingRow('active', { slotId: slot.id });

    const res = await confirm(admin.cookie, booking.id);

    expect(res.status).toBe(422);
    expect(error(res).code).toBe('CHECK_IN_TOO_EARLY');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('active');
  });

  it('US-A.7-AC-02: повторне підтвердження — already_confirmed без змін', async () => {
    const admin = await adminSession(app);
    const { booking } = await currentBooking();
    const first = (await confirm(admin.cookie, booking.id)).body as CheckInResult;

    const res = await confirm(admin.cookie, booking.id);

    expect(res.status).toBe(200);
    const again = res.body as CheckInResult;
    expect(again.result).toBe('already_confirmed');
    expect(again.booking.confirmedAt).toBe(first.booking.confirmedAt);
    expect(await prisma.booking.count({ where: { slotId: booking.slotId } })).toBe(1);
  });
});

describe('SYS-AC-08, US-1.2-AC-03 — підготовлений адміністратор і реєстрація студента', () => {
  it('SYS-AC-08: адміністратор, створений поза публічною реєстрацією, входить і отримує role "admin"', async () => {
    const admin = await createUser({ role: 'admin', name: 'Адмін' });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: admin.password });

    expect(login.status).toBe(200);
    expect((login.body as MeResponse).user.role).toBe('admin');
    const me = await call('get', '/api/auth/me', sessionCookieFrom(login));
    expect((me.body as MeResponse).user).toMatchObject({ id: admin.id, role: 'admin' });
  });

  it('US-1.2-AC-03: реєстрація з role "admin" у тілі створює студента без доступу до адмін-API', async () => {
    const email = `student-${randomUUID()}@example.com`;

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Олена', email, password: 'secret-pass', role: 'admin' });

    expect(res.status).toBe(201);
    expect((res.body as MeResponse).user.role).toBe('student');
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).role).toBe('student');
    const body = roomBody();
    const attempt = await call('post', '/api/admin/rooms', sessionCookieFrom(res), body);
    expect(attempt.status).toBe(403);
    expect(error(attempt).code).toBe('FORBIDDEN');
    expect(await prisma.room.count({ where: { name: body.name } })).toBe(0);
  });
});

describe('SYS-AC-09 — адмін-ендпоінти закриті для гостя й студента', () => {
  // 6 реалізованих шляхів api_spec.md §9 (адмін-скасування чекає Q03/Q18) і неіснуючий шлях.
  // Тіла валідні, а id неіснуючі, тож адміністратор доходить до бізнес-результату з контракту
  // (§9, error_format.md), а не до VALIDATION_ERROR: точний статус ловить і 500, і зламаний guard.
  type Endpoint = {
    name: string;
    method: 'get' | 'post' | 'patch';
    path: string;
    body?: () => object;
    admin: { status: number; code: string | null };
  };
  const endpoints: Endpoint[] = [
    {
      name: 'POST /api/admin/rooms',
      method: 'post',
      path: '/api/admin/rooms',
      body: () => roomBody(),
      admin: { status: 201, code: null },
    },
    {
      name: 'PATCH /api/admin/rooms/:roomId',
      method: 'patch',
      path: `/api/admin/rooms/${MISSING_ID}`,
      body: () => ({ capacity: 6 }),
      admin: { status: 404, code: 'ROOM_NOT_FOUND' },
    },
    {
      name: 'POST /api/admin/rooms/:roomId/slots',
      method: 'post',
      path: `/api/admin/rooms/${MISSING_ID}/slots`,
      body: () => NEW_SLOT,
      admin: { status: 404, code: 'ROOM_NOT_FOUND' },
    },
    {
      name: 'GET /api/admin/rooms/:roomId/qr',
      method: 'get',
      path: `/api/admin/rooms/${MISSING_ID}/qr`,
      admin: { status: 404, code: 'ROOM_NOT_FOUND' },
    },
    {
      name: 'GET /api/admin/bookings',
      method: 'get',
      path: '/api/admin/bookings',
      admin: { status: 200, code: null },
    },
    {
      name: 'POST /api/admin/bookings/:bookingId/confirm',
      method: 'post',
      path: `/api/admin/bookings/${MISSING_ID}/confirm`,
      admin: { status: 404, code: 'BOOKING_NOT_FOUND' },
    },
    {
      name: 'GET неіснуючий /api/admin/...',
      method: 'get',
      path: '/api/admin/no-such-route',
      admin: { status: 404, code: 'ENDPOINT_NOT_FOUND' },
    },
  ];

  it.each(endpoints)(
    'SYS-AC-09: $name — гість 401, студент 403, адміністратор отримує результат контракту',
    async ({ method, path, body, admin: expected }) => {
      const student = await studentSession();
      const admin = await adminSession(app);

      // Одне тіло на всі три ролі: для створення кімнати це та сама унікальна назва.
      const payload = body?.();

      const guest = await call(method, path, null, payload);
      expect(guest.status).toBe(401);
      expect(error(guest).code).toBe('UNAUTHENTICATED');

      const asStudent = await call(method, path, student.cookie, payload);
      expect(asStudent.status).toBe(403);
      expect(error(asStudent).code).toBe('FORBIDDEN');

      const asAdmin = await call(method, path, admin.cookie, payload);
      expect(asAdmin.status).toBe(expected.status);
      if (expected.code) expect(error(asAdmin).code).toBe(expected.code);
      // Наслідок, а не лише статус: кімнату збережено рівно один раз — адміністратором, не гостем і не студентом.
      if (payload && 'name' in payload) {
        expect(await prisma.room.count({ where: { name: payload.name as string } })).toBe(1);
      }
    },
  );
});

describe('FB-12 — токен QR не потрапляє у відповіді поза GET /api/admin/rooms/:roomId/qr', () => {
  it('FB-12: значення токена відсутнє в каталозі, деталях кімнати, бронюваннях, check-in і списку адміністратора', async () => {
    const admin = await adminSession(app);
    const owner = await studentSession('Олена');
    const scanner = await studentSession('Богдан');
    const { room } = await currentBooking('active', owner.userId);
    const token = room.qrToken;

    const responses = {
      rooms: await call('get', '/api/rooms', owner.cookie),
      room: await call('get', `/api/rooms/${room.id}`, owner.cookie),
      bookings: await call('get', '/api/bookings?scope=past', owner.cookie),
      checkIn: await call('post', '/api/check-ins', scanner.cookie, { qrToken: token }),
      adminBookings: await call('get', '/api/admin/bookings', admin.cookie),
    };

    // Відповіді справжні й містять саме цю кімнату чи бронювання, інакше відсутність токена нічого не доводить.
    expect((responses.rooms.body as RoomListResponse).rooms.some((r) => r.id === room.id)).toBe(true);
    expect((responses.room.body as RoomResponse).room.id).toBe(room.id);
    expect((responses.bookings.body as BookingListResponse).bookings.some((b) => b.room.id === room.id)).toBe(
      true,
    );
    expect((responses.checkIn.body as CheckInResult).booking.room.id).toBe(room.id);
    expect(
      (responses.adminBookings.body as AdminBookingListResponse).bookings.some((b) => b.room.id === room.id),
    ).toBe(true);

    for (const [name, res] of Object.entries(responses)) {
      expect(res.status, name).toBe(200);
      expect(JSON.stringify(res.body), name).not.toContain(token);
    }
  });
});
