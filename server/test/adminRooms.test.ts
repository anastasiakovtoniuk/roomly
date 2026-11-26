import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type {
  AvailableSlotListResponse,
  ErrorBody,
  QrTokenResponse,
  RoomListResponse,
  RoomResponse,
  SlotResponse,
} from '@roomly/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { AppError } from '../src/lib/appError';
import { createSlot as createSlotService } from '../src/modules/admin/adminRooms.service';
import { adminSession, registerStudent } from './helpers/auth';
import { createRoom, createSlot } from './helpers/factories';
import { at, useClock } from './helpers/time';

const app = createApp();

// 10:00 за Києвом (UTC+2 узимку). Слоти тестів — 5 листопада, у майбутньому відносно NOW.
const NOW = new Date('2026-11-03T08:00:00.000Z');
const DAY = '2026-11-05';
// 10:00–11:00 за Києвом 5 листопада.
const START = '2026-11-05T08:00:00.000Z';
const END = '2026-11-05T09:00:00.000Z';

const MISSING_ROOM_ID = '00000000-0000-4000-8000-000000000000';

function errorCode(res: request.Response) {
  return (res.body as ErrorBody).error.code;
}

function fieldPaths(res: request.Response) {
  const fields = (res.body as ErrorBody).error.details?.fields as { path: string }[] | undefined;
  return (fields ?? []).map((field) => field.path);
}

function roomBody(overrides: Record<string, unknown> = {}) {
  return {
    name: `Адмін-кімната ${randomUUID()}`,
    capacity: 6,
    building: 'Корпус 2',
    floor: 3,
    equipment: ['Проєктор', 'Дошка'],
    ...overrides,
  };
}

// Запит із cookie (або без, якщо null). Для POST/PATCH завжди JSON: requireJson інакше відповів би
// VALIDATION_ERROR раніше за перевірку ролі.
function call(method: 'get' | 'post' | 'patch', path: string, cookie: string | null, body?: object) {
  const req = request(app)[method](path);
  if (cookie) req.set('Cookie', cookie);
  return method === 'get' ? req : req.send(body ?? {});
}

function postSlot(cookie: string, roomId: string, startsAt: string, endsAt: string) {
  return call('post', `/api/admin/rooms/${roomId}/slots`, cookie, { startsAt, endsAt });
}

async function slotCount(roomId: string) {
  return prisma.slot.count({ where: { roomId } });
}

// Усі ендпоінти issue #41 і неіснуючий шлях під /api/admin.
function adminEndpoints(roomId: string) {
  return [
    { method: 'post' as const, path: '/api/admin/rooms', body: roomBody() },
    { method: 'patch' as const, path: `/api/admin/rooms/${roomId}`, body: { capacity: 99 } },
    {
      method: 'post' as const,
      path: `/api/admin/rooms/${roomId}/slots`,
      body: { startsAt: START, endsAt: END },
    },
    { method: 'get' as const, path: `/api/admin/rooms/${roomId}/qr` },
    { method: 'get' as const, path: '/api/admin/xyz' },
    { method: 'post' as const, path: '/api/admin/xyz', body: {} },
  ];
}

describe('Доступ до /api/admin/*', () => {
  useClock(NOW);

  it('SYS-AC-09: гість отримує 401 UNAUTHENTICATED на кожному адмін-ендпоінті', async () => {
    const room = await createRoom();
    for (const endpoint of adminEndpoints(room.id)) {
      const res = await call(endpoint.method, endpoint.path, null, endpoint.body);
      expect(res.status, `${endpoint.method} ${endpoint.path}`).toBe(401);
      expect(errorCode(res)).toBe('UNAUTHENTICATED');
    }
  });

  it('SYS-AC-09: студент отримує 403 FORBIDDEN на кожному адмін-ендпоінті, зокрема на неіснуючому шляху', async () => {
    const student = await registerStudent(app);
    const room = await createRoom();
    for (const endpoint of adminEndpoints(room.id)) {
      const res = await call(endpoint.method, endpoint.path, student.cookie, endpoint.body);
      expect(res.status, `${endpoint.method} ${endpoint.path}`).toBe(403);
      expect(errorCode(res)).toBe('FORBIDDEN');
      expect(JSON.stringify(res.body)).not.toContain(room.qrToken);
    }
    // Нічого не змінилося.
    const stored = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(stored.capacity).toBe(room.capacity);
    expect(await slotCount(room.id)).toBe(0);
  });

  it('SYS-AC-09: роль береться із сесії — role у тілі запиту студента не дає доступу', async () => {
    const student = await registerStudent(app);
    const res = await call('post', '/api/admin/rooms', student.cookie, { ...roomBody(), role: 'admin' });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('SYS-AC-08: адміністратор на неіснуючому шляху /api/admin/* отримує 404 ENDPOINT_NOT_FOUND', async () => {
    const admin = await adminSession(app);
    const res = await call('get', '/api/admin/xyz', admin.cookie);
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('ENDPOINT_NOT_FOUND');
  });
});

describe('POST /api/admin/rooms', () => {
  useClock(NOW);

  it('US-A.1a-AC-01: адміністратор створює кімнату — 201 { room } без qrToken, токен згенеровано в БД', async () => {
    const admin = await adminSession(app);
    const body = roomBody();

    const res = await call('post', '/api/admin/rooms', admin.cookie, body);

    expect(res.status).toBe(201);
    const { room } = res.body as RoomResponse;
    expect(room).toEqual({ id: expect.any(String) as string, ...body });
    expect(Object.keys(room)).not.toContain('qrToken');

    const stored = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(JSON.parse(stored.equipment)).toEqual(body.equipment);
    // 24 випадкові байти в base64url — 32 символи, ≥ 128 біт (data_model.md §3.2).
    expect(stored.qrToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(JSON.stringify(res.body)).not.toContain(stored.qrToken);
  });

  it('US-A.1a-AC-01: qrToken із тіла запиту ігнорується — токен генерує лише сервер', async () => {
    const admin = await adminSession(app);
    const res = await call('post', '/api/admin/rooms', admin.cookie, { ...roomBody(), qrToken: 'my-token' });

    expect(res.status).toBe(201);
    const stored = await prisma.room.findUniqueOrThrow({ where: { id: (res.body as RoomResponse).room.id } });
    expect(stored.qrToken).not.toBe('my-token');
  });

  it('US-A.1a-AC-01: пробіли по краях обрізаються, порожній перелік обладнання дозволений', async () => {
    const admin = await adminSession(app);
    const name = `Кімната ${randomUUID()}`;
    const res = await call('post', '/api/admin/rooms', admin.cookie, {
      ...roomBody({ name: `  ${name}  `, building: ' Бібліотека ', equipment: [] }),
    });

    expect(res.status).toBe(201);
    expect((res.body as RoomResponse).room).toMatchObject({ name, building: 'Бібліотека', equipment: [] });
  });

  it('US-A.1a-AC-02: створена кімната з характеристиками є в GET /api/rooms студента без qrToken', async () => {
    const admin = await adminSession(app);
    const student = await registerStudent(app);
    const created = await call('post', '/api/admin/rooms', admin.cookie, roomBody());
    const { room } = created.body as RoomResponse;
    const { qrToken } = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });

    const list = await call('get', '/api/rooms', student.cookie);
    expect(list.status).toBe(200);
    expect((list.body as RoomListResponse).rooms).toContainEqual(room);
    expect(JSON.stringify(list.body)).not.toContain(qrToken);

    const details = await call('get', `/api/rooms/${room.id}`, student.cookie);
    expect((details.body as RoomResponse).room).toEqual(room);
    expect(JSON.stringify(details.body)).not.toContain(qrToken);
  });

  it('US-A.1a-AC-03: студент не створює кімнату — 403, запису в БД немає', async () => {
    const student = await registerStudent(app);
    const body = roomBody();

    const res = await call('post', '/api/admin/rooms', student.cookie, body);

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(await prisma.room.count({ where: { name: body.name } })).toBe(0);
  });

  // [Пропозиція] Q09: унікальність назви не вимагається (data_model.md §3.2), коду помилки для
  // дубліката в error_format.md немає. Якщо команда вирішить інакше, цей тест зміниться разом із контрактом.
  it('US-A.1a-AC-01 (Q09): дві кімнати з однаковою назвою створюються окремо з різними токенами', async () => {
    const admin = await adminSession(app);
    const body = roomBody();

    const first = await call('post', '/api/admin/rooms', admin.cookie, body);
    const second = await call('post', '/api/admin/rooms', admin.cookie, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const stored = await prisma.room.findMany({ where: { name: body.name } });
    expect(stored).toHaveLength(2);
    expect(stored[0]?.qrToken).not.toBe(stored[1]?.qrToken);
  });

  it.each([
    ['name', { name: '   ' }],
    ['name', { name: 'x'.repeat(101) }],
    ['name', { name: undefined }],
    ['capacity', { capacity: 0 }],
    ['capacity', { capacity: 2.5 }],
    ['capacity', { capacity: '6' }],
    ['building', { building: '' }],
    ['building', { building: undefined }],
    ['floor', { floor: 1.5 }],
    ['floor', { floor: undefined }],
    ['equipment', { equipment: undefined }],
    ['equipment', { equipment: 'Дошка' }],
    ['equipment', { equipment: Array.from({ length: 21 }, (_, i) => `Пристрій ${i}`) }],
    ['equipment.0', { equipment: [' '] }],
    ['equipment', { equipment: ['Дошка', ' Дошка '] }],
  ])(
    'US-A.1a-AC-01: невалідне поле %s — 400 VALIDATION_ERROR, кімнату не створено (%j)',
    async (path, patch) => {
      const admin = await adminSession(app);
      const body = roomBody(patch);

      const res = await call('post', '/api/admin/rooms', admin.cookie, body);

      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
      expect(fieldPaths(res)).toContain(path);
      if (typeof body.name === 'string') {
        expect(await prisma.room.count({ where: { name: body.name.trim() } })).toBe(0);
      }
    },
  );
});

describe('PATCH /api/admin/rooms/:roomId', () => {
  useClock(NOW);

  it('US-A.1b-AC-01, US-A.1b-AC-02: адміністратор змінює всі характеристики, студент бачить зміни', async () => {
    const admin = await adminSession(app);
    const student = await registerStudent(app);
    const room = await createRoom({ equipment: ['Дошка'] });
    const update = roomBody({ capacity: 12, building: 'Корпус 7', floor: -1, equipment: ['Телевізор'] });

    const res = await call('patch', `/api/admin/rooms/${room.id}`, admin.cookie, update);

    expect(res.status).toBe(200);
    expect((res.body as RoomResponse).room).toEqual({ id: room.id, ...update });

    const seen = await call('get', `/api/rooms/${room.id}`, student.cookie);
    expect((seen.body as RoomResponse).room).toEqual({ id: room.id, ...update });
  });

  it('US-A.1b-AC-03: зміна одного поля не чіпає решту, qrToken і не створює другої кімнати', async () => {
    const admin = await adminSession(app);
    const room = await createRoom({ equipment: ['Дошка', 'Проєктор'] });

    const res = await call('patch', `/api/admin/rooms/${room.id}`, admin.cookie, { capacity: 10 });

    expect(res.status).toBe(200);
    expect((res.body as RoomResponse).room).toEqual({
      id: room.id,
      name: room.name,
      capacity: 10,
      building: room.building,
      floor: room.floor,
      equipment: ['Дошка', 'Проєктор'],
    });
    const stored = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(stored.qrToken).toBe(room.qrToken);
    expect(await prisma.room.count({ where: { name: room.name } })).toBe(1);
  });

  it('US-A.1b-AC-01: equipment замінюється цілком, порожній перелік очищає обладнання', async () => {
    const admin = await adminSession(app);
    const room = await createRoom({ equipment: ['Дошка', 'Проєктор'] });

    const res = await call('patch', `/api/admin/rooms/${room.id}`, admin.cookie, { equipment: [] });

    expect(res.status).toBe(200);
    expect((res.body as RoomResponse).room.equipment).toEqual([]);
  });

  it('US-A.1b-AC-03: qrToken у тілі не змінює токен; тіло лише з ним — порожнє, 400', async () => {
    const admin = await adminSession(app);
    const room = await createRoom();

    const onlyToken = await call('patch', `/api/admin/rooms/${room.id}`, admin.cookie, { qrToken: 'new' });
    expect(onlyToken.status).toBe(400);
    expect(errorCode(onlyToken)).toBe('VALIDATION_ERROR');

    const withToken = await call('patch', `/api/admin/rooms/${room.id}`, admin.cookie, {
      floor: 4,
      qrToken: 'new',
    });
    expect(withToken.status).toBe(200);
    expect(JSON.stringify(withToken.body)).not.toContain(room.qrToken);
    const stored = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(stored.qrToken).toBe(room.qrToken);
    expect(stored.floor).toBe(4);
  });

  it('US-A.1b-AC-01: порожнє тіло, невалідне поле й не-UUID — 400 VALIDATION_ERROR', async () => {
    const admin = await adminSession(app);
    const room = await createRoom();

    const empty = await call('patch', `/api/admin/rooms/${room.id}`, admin.cookie, {});
    expect(empty.status).toBe(400);
    expect(errorCode(empty)).toBe('VALIDATION_ERROR');

    const invalid = await call('patch', `/api/admin/rooms/${room.id}`, admin.cookie, { capacity: 0 });
    expect(invalid.status).toBe(400);
    expect(fieldPaths(invalid)).toContain('capacity');

    const badId = await call('patch', '/api/admin/rooms/not-a-uuid', admin.cookie, { capacity: 3 });
    expect(badId.status).toBe(400);
    expect(fieldPaths(badId)).toContain('params.roomId');

    const stored = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(stored.capacity).toBe(room.capacity);
  });

  it('US-A.1b-AC-01: неіснуюча кімната — 404 ROOM_NOT_FOUND', async () => {
    const admin = await adminSession(app);
    const res = await call('patch', `/api/admin/rooms/${MISSING_ROOM_ID}`, admin.cookie, { capacity: 3 });
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('ROOM_NOT_FOUND');
  });

  it('US-A.1b-AC-01: студент не змінює кімнату — 403, дані без змін', async () => {
    const student = await registerStudent(app);
    const room = await createRoom();

    const res = await call('patch', `/api/admin/rooms/${room.id}`, student.cookie, { capacity: 50 });

    expect(res.status).toBe(403);
    const stored = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(stored.capacity).toBe(room.capacity);
  });
});

describe('POST /api/admin/rooms/:roomId/slots', () => {
  useClock(NOW);

  it('US-A.2-AC-01, US-A.2-AC-02: адміністратор створює слот — 201 { slot }, студент бачить його вільним', async () => {
    const admin = await adminSession(app);
    const student = await registerStudent(app);
    const room = await createRoom();

    const res = await postSlot(admin.cookie, room.id, START, END);

    expect(res.status).toBe(201);
    const { slot } = res.body as SlotResponse;
    expect(slot).toEqual({ id: expect.any(String) as string, roomId: room.id, startsAt: START, endsAt: END });
    expect(await slotCount(room.id)).toBe(1);

    const available = await call('get', `/api/rooms/${room.id}/available-slots?date=${DAY}`, student.cookie);
    expect(available.status).toBe(200);
    expect((available.body as AvailableSlotListResponse).slots.map((s) => s.id)).toEqual([slot.id]);
  });

  it('US-A.2-AC-03: студент не створює слот — 403, слота в БД немає', async () => {
    const student = await registerStudent(app);
    const room = await createRoom();

    const res = await postSlot(student.cookie, room.id, START, END);

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(await slotCount(room.id)).toBe(0);
  });

  it('US-A.2-AC-01: неіснуюча кімната — 404 ROOM_NOT_FOUND, слот не створено', async () => {
    const admin = await adminSession(app);
    const before = await prisma.slot.count();

    const res = await postSlot(admin.cookie, MISSING_ROOM_ID, START, END);

    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('ROOM_NOT_FOUND');
    expect(await prisma.slot.count()).toBe(before);
  });

  it.each([
    ['завершення раніше за початок', END, START],
    ['нульова тривалість', START, START],
  ])('US-A.2-AC-01 (BR-13): %s — 400 VALIDATION_ERROR', async (_name, startsAt, endsAt) => {
    const admin = await adminSession(app);
    const room = await createRoom();

    const res = await postSlot(admin.cookie, room.id, startsAt, endsAt);

    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
    expect(fieldPaths(res)).toContain('endsAt');
    expect(await slotCount(room.id)).toBe(0);
  });

  it.each([
    ['startsAt без Z', { startsAt: '2026-11-05T08:00:00', endsAt: END }, 'startsAt'],
    ['endsAt зі зсувом', { startsAt: START, endsAt: '2026-11-05T11:00:00+02:00' }, 'endsAt'],
    ['без startsAt', { endsAt: END }, 'startsAt'],
    ['без endsAt', { startsAt: START }, 'endsAt'],
    ['startsAt не рядок', { startsAt: 1, endsAt: END }, 'startsAt'],
  ])('US-A.2-AC-01: %s — 400 VALIDATION_ERROR', async (_name, body, path) => {
    const admin = await adminSession(app);
    const room = await createRoom();

    const res = await call('post', `/api/admin/rooms/${room.id}/slots`, admin.cookie, body);

    expect(res.status).toBe(400);
    expect(fieldPaths(res)).toContain(path);
    expect(await slotCount(room.id)).toBe(0);
  });

  it('US-A.2-AC-01: roomId не UUID — 400 VALIDATION_ERROR', async () => {
    const admin = await adminSession(app);
    const res = await postSlot(admin.cookie, 'not-a-uuid', START, END);
    expect(res.status).toBe(400);
    expect(fieldPaths(res)).toContain('params.roomId');
  });

  // [Пропозиція] Q10: endsAt > now.
  it('US-A.2-AC-01 (Q10): слот, що вже завершився, — 400 VALIDATION_ERROR', async () => {
    const admin = await adminSession(app);
    const room = await createRoom();

    const res = await postSlot(
      admin.cookie,
      room.id,
      at(NOW, -120).toISOString(),
      at(NOW, -60).toISOString(),
    );

    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
    expect(fieldPaths(res)).toContain('endsAt');
    expect(await slotCount(room.id)).toBe(0);
  });

  it('US-A.2-AC-01 (Q10): слот, що завершується рівно зараз, — 400 VALIDATION_ERROR', async () => {
    const admin = await adminSession(app);
    const room = await createRoom();

    const res = await postSlot(admin.cookie, room.id, at(NOW, -60).toISOString(), NOW.toISOString());

    expect(res.status).toBe(400);
    expect(await slotCount(room.id)).toBe(0);
  });

  it('US-A.2-AC-01 (Q10): слот, що почався, але ще не завершився, створюється', async () => {
    const admin = await adminSession(app);
    const room = await createRoom();

    const res = await postSlot(admin.cookie, room.id, at(NOW, -10).toISOString(), at(NOW, 50).toISOString());

    expect(res.status).toBe(201);
    expect(await slotCount(room.id)).toBe(1);
  });

  // [Пропозиція] G7: та сама дата університету (Europe/Kyiv у тестах).
  it('US-A.2-AC-01 (G7): початок і кінець у різні дати університету — 400 VALIDATION_ERROR', async () => {
    const admin = await adminSession(app);
    const room = await createRoom();

    // 23:00 5 листопада — 01:00 6 листопада за Києвом.
    const res = await postSlot(admin.cookie, room.id, '2026-11-05T21:00:00.000Z', '2026-11-05T23:00:00.000Z');

    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
    expect(fieldPaths(res)).toContain('endsAt');
    expect(await slotCount(room.id)).toBe(0);
  });

  it('US-A.2-AC-01 (G7): слот, що закінчується рівно опівночі, відхиляється — найсуворіший варіант', async () => {
    const admin = await adminSession(app);
    const room = await createRoom();

    // 23:00–00:00 за Києвом.
    const res = await postSlot(admin.cookie, room.id, '2026-11-05T21:00:00.000Z', '2026-11-05T22:00:00.000Z');

    expect(res.status).toBe(400);
    expect(await slotCount(room.id)).toBe(0);
  });

  it('US-A.2-AC-01 (G7): межу дати визначає пояс університету, а не UTC', async () => {
    const admin = await adminSession(app);
    const room = await createRoom();

    // 01:00–03:00 6 листопада за Києвом — одна дата, хоча в UTC це 5 листопада 23:00 — 6 листопада 01:00.
    const res = await postSlot(admin.cookie, room.id, '2026-11-05T23:00:00.000Z', '2026-11-06T01:00:00.000Z');

    expect(res.status).toBe(201);
  });

  it.each([
    ['той самий інтервал', START, END],
    ['новий охоплює наявний', at(START, -30).toISOString(), at(END, 30).toISOString()],
    ['новий усередині наявного', at(START, 15).toISOString(), at(END, -15).toISOString()],
    ['перетин зліва', at(START, -30).toISOString(), at(START, 30).toISOString()],
    ['перетин справа', at(END, -30).toISOString(), at(END, 30).toISOString()],
    ['перетин на одну хвилину', at(END, -1).toISOString(), at(END, 59).toISOString()],
  ])('US-A.2-AC-01 (BR-13): %s — 409 SLOT_OVERLAP, нового слота немає', async (_name, startsAt, endsAt) => {
    const admin = await adminSession(app);
    const room = await createRoom();
    const existing = await createSlot(room.id, START);

    const res = await postSlot(admin.cookie, room.id, startsAt, endsAt);

    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('SLOT_OVERLAP');
    const stored = await prisma.slot.findMany({ where: { roomId: room.id } });
    expect(stored.map((slot) => slot.id)).toEqual([existing.id]);
  });

  // [Пропозиція] G7/Q10: півінтервали [startsAt, endsAt) — суміжні слоти не перетинаються (як у seed-demo).
  it('US-A.2-AC-01 (G7/Q10): суміжні слоти до й після наявного створюються', async () => {
    const admin = await adminSession(app);
    const room = await createRoom();
    await createSlot(room.id, START);

    const before = await postSlot(admin.cookie, room.id, at(START, -60).toISOString(), START);
    const after = await postSlot(admin.cookie, room.id, END, at(END, 60).toISOString());

    expect(before.status).toBe(201);
    expect(after.status).toBe(201);
    expect(await slotCount(room.id)).toBe(3);
  });

  it('US-A.2-AC-01 (BR-13): той самий час в іншій кімнаті не є перетином', async () => {
    const admin = await adminSession(app);
    const busy = await createRoom();
    const other = await createRoom();
    await createSlot(busy.id, START);

    const res = await postSlot(admin.cookie, other.id, START, END);

    expect(res.status).toBe(201);
    expect(await slotCount(other.id)).toBe(1);
  });

  it('US-A.2-AC-01 (BR-13): паралельні створення того самого слота — рівно один успіх, решта SLOT_OVERLAP', async () => {
    const room = await createRoom();
    const attempts = 5;

    // Виклики сервісу без HTTP: так операції справді перемежовуються на одному з'єднанні з БД.
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () => createSlotService(room.id, START, END)),
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(attempts - 1);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(AppError);
      expect((result.reason as AppError).code).toBe('SLOT_OVERLAP');
    }
    expect(await slotCount(room.id)).toBe(1);
  });

  it('US-A.2-AC-01 (BR-13): паралельні часткові перетини — у БД лишаються лише слоти без перетину', async () => {
    const room = await createRoom();
    const intervals = [
      [START, END],
      [at(START, 30).toISOString(), at(END, 30).toISOString()],
      [at(START, -30).toISOString(), at(START, 30).toISOString()],
    ] as const;

    const results = await Promise.allSettled(intervals.map(([s, e]) => createSlotService(room.id, s, e)));

    expect(results.filter((result) => result.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    const stored = await prisma.slot.findMany({ where: { roomId: room.id }, orderBy: { startsAt: 'asc' } });
    expect(stored.length).toBe(results.filter((result) => result.status === 'fulfilled').length);
    for (let i = 1; i < stored.length; i += 1) {
      const previous = stored[i - 1];
      const current = stored[i];
      if (!previous || !current) throw new Error('unreachable');
      expect(current.startsAt.getTime()).toBeGreaterThanOrEqual(previous.endsAt.getTime());
    }
  });
});

describe('GET /api/admin/rooms/:roomId/qr', () => {
  useClock(NOW);

  it('US-A.4a-AC-01, US-A.4a-AC-02: адміністратор отримує токен кімнати без бронювань, повтор дає той самий (FB-13)', async () => {
    const admin = await adminSession(app);
    const room = await createRoom();

    const first = await call('get', `/api/admin/rooms/${room.id}/qr`, admin.cookie);
    const second = await call('get', `/api/admin/rooms/${room.id}/qr`, admin.cookie);

    expect(first.status).toBe(200);
    const body: QrTokenResponse = { roomId: room.id, roomName: room.name, qrToken: room.qrToken };
    expect(first.body).toEqual(body);
    expect(second.body).toEqual(body);
    expect(await prisma.booking.count({ where: { slot: { roomId: room.id } } })).toBe(0);
  });

  it('US-A.4a-AC-03: токени двох кімнат різні й кожен ідентифікує свою кімнату', async () => {
    const admin = await adminSession(app);
    const created = await Promise.all([
      call('post', '/api/admin/rooms', admin.cookie, roomBody()),
      call('post', '/api/admin/rooms', admin.cookie, roomBody()),
    ]);
    const [a, b] = created.map((res) => (res.body as RoomResponse).room);
    if (!a || !b) throw new Error('Кімнати не створено');

    const qrA = (await call('get', `/api/admin/rooms/${a.id}/qr`, admin.cookie)).body as QrTokenResponse;
    const qrB = (await call('get', `/api/admin/rooms/${b.id}/qr`, admin.cookie)).body as QrTokenResponse;

    expect(qrA.qrToken).not.toBe(qrB.qrToken);
    expect((await prisma.room.findUniqueOrThrow({ where: { qrToken: qrA.qrToken } })).id).toBe(a.id);
    expect((await prisma.room.findUniqueOrThrow({ where: { qrToken: qrB.qrToken } })).id).toBe(b.id);
    expect(qrA).toMatchObject({ roomId: a.id, roomName: a.name });
  });

  it('US-A.4b-AC-03: студент не отримує токен — 403 без токена у відповіді', async () => {
    const student = await registerStudent(app);
    const room = await createRoom();

    const res = await call('get', `/api/admin/rooms/${room.id}/qr`, student.cookie);

    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(JSON.stringify(res.body)).not.toContain(room.qrToken);
  });

  it('US-A.4a-AC-01: неіснуюча кімната — 404 ROOM_NOT_FOUND, не-UUID — 400', async () => {
    const admin = await adminSession(app);

    const missing = await call('get', `/api/admin/rooms/${MISSING_ROOM_ID}/qr`, admin.cookie);
    expect(missing.status).toBe(404);
    expect(errorCode(missing)).toBe('ROOM_NOT_FOUND');

    const badId = await call('get', '/api/admin/rooms/not-a-uuid/qr', admin.cookie);
    expect(badId.status).toBe(400);
    expect(fieldPaths(badId)).toContain('params.roomId');
  });

  it('US-A.4a-AC-01 (FB-12): токен не віддається в каталозі студенту й адміністратору', async () => {
    const admin = await adminSession(app);
    const student = await registerStudent(app);
    const room = await createRoom();
    await createSlot(room.id, START);

    for (const cookie of [student.cookie, admin.cookie]) {
      for (const path of [
        '/api/rooms',
        `/api/rooms/${room.id}`,
        `/api/rooms/${room.id}/available-slots?date=${DAY}`,
      ]) {
        const res = await call('get', path, cookie);
        expect(res.status, path).toBe(200);
        expect(JSON.stringify(res.body), path).not.toContain(room.qrToken);
        expect(JSON.stringify(res.body), path).not.toContain('qrToken');
      }
    }
  });
});
