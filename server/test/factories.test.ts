import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { type MeResponse } from '@roomly/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { adminSession, registerStudent } from './helpers/auth';
import { createBookingRow, createRoom, createSlot, createUser } from './helpers/factories';
import { at, useClock } from './helpers/time';

const app = createApp();

useClock();

// Хелпери — основа ізоляції тестів у спільній базі: кожен виклик дає нові дані.
describe('тестові хелпери', () => {
  it('SYS-AC-06 ізоляція: кожна фабрика створює унікальні записи', async () => {
    const [roomA, roomB] = [await createRoom(), await createRoom()];
    const [userA, userB] = [await createUser(), await createUser()];

    expect(roomA.id).not.toBe(roomB.id);
    expect(roomA.name).not.toBe(roomB.name);
    expect(roomA.qrToken).not.toBe(roomB.qrToken);
    expect(userA.email).not.toBe(userB.email);
  });

  it('SYS-AC-06 createBookingRow створює кімнату, слот і власника та ставить дедлайн від початку слота', async () => {
    const start = '2026-11-03T08:00:00.000Z';

    const booking = await createBookingRow('confirmed', { startsAt: start });

    const stored = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { slot: true },
    });
    expect(stored.status).toBe('confirmed');
    expect(stored.slot.startsAt.toISOString()).toBe(start);
    expect(stored.deadline.toISOString()).toBe(at(start, 15).toISOString());
    expect(stored.confirmedAt).not.toBeNull();
  });

  it('SYS-AC-06 два живі бронювання одного слота відхиляє БД, а автоскасоване слот не утримує', async () => {
    const slot = await createSlot((await createRoom()).id, '2026-11-03T08:00:00.000Z');
    await createBookingRow('active', { slotId: slot.id });

    await expect(createBookingRow('active', { slotId: slot.id })).rejects.toThrow();
    await expect(createBookingRow('auto_cancelled', { slotId: slot.id })).resolves.toBeDefined();
  });

  it('SYS-AC-09 adminSession входить як адміністратор, registerStudent — як студент', async () => {
    const admin = await adminSession(app);
    const student = await registerStudent(app);

    const adminMe = await request(app).get('/api/auth/me').set('Cookie', admin.cookie);
    const studentMe = await request(app).get('/api/auth/me').set('Cookie', student.cookie);

    expect((adminMe.body as MeResponse).user.role).toBe('admin');
    expect((studentMe.body as MeResponse).user.role).toBe('student');
    expect((studentMe.body as MeResponse).user.id).toBe(student.userId);
  });
});
