import { randomUUID } from 'node:crypto';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME, type BookingResponse } from '@roomly/shared';
import { createApp } from '../src/app';
import { databaseUrl } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { PrismaClient } from '../src/generated/prisma/client';
import { resetClock, setClock } from '../src/lib/clock';

const app = createApp();

afterEach(() => {
  resetClock();
});

// Наскрізний критерій BF-S08 з booking_flow.md («дані на місці після перезапуску»). Окремого ID
// у results/3.5 немає, а BF-S за booking_flow.md у назвах тестів не використовується.
describe('збереження після перезапуску (issue #9)', () => {
  it('новий екземпляр Prisma-клієнта читає бронювання, створене через API, з тим самим статусом і deadline', async () => {
    setClock(() => new Date('2026-11-02T09:30:00.000Z'));
    const room = await prisma.room.create({
      data: {
        name: `Кімната ${randomUUID()}`,
        capacity: 4,
        building: 'Корпус 1',
        floor: 1,
        equipment: '[]',
        qrToken: `qr-${randomUUID()}`,
      },
    });
    const slot = await prisma.slot.create({
      data: {
        roomId: room.id,
        startsAt: new Date('2026-11-03T08:00:00.000Z'),
        endsAt: new Date('2026-11-03T09:00:00.000Z'),
      },
    });
    const register = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Олена', email: `student-${randomUUID()}@example.com`, password: 'secret-pass' });
    expect(register.status).toBe(201);
    const cookie = String(register.headers['set-cookie']?.[0] ?? '')
      .split(';', 1)
      .join('');
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);
    const created = await request(app).post('/api/bookings').set('Cookie', cookie).send({ slotId: slot.id });
    expect(created.status).toBe(201);
    const { booking } = created.body as BookingResponse;

    // Імітація перезапуску: окремий клієнт з новим з'єднанням до того самого файла SQLite.
    const restarted = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
    try {
      const stored = await restarted.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(stored.slotId).toBe(slot.id);
      expect(stored.status).toBe('active');
      expect(stored.deadline.toISOString()).toBe(booking.deadline);
      expect(stored.createdAt.toISOString()).toBe(booking.createdAt);
    } finally {
      await restarted.$disconnect();
    }
  });
});
