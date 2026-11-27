import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  LIVE_BOOKING_STATUSES,
  type AvailableSlotListResponse,
  type BookingListResponse,
  type BookingResponse,
} from '@roomly/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { setClock } from '../src/lib/clock';
import { cancelExpiredBookings } from '../src/modules/bookings/autoCancel';
import { adminSession, sessionCookieFrom } from './helpers/auth';
import { createBookingRow, createRoom, createSlot, createUser } from './helpers/factories';
import { at, useClock } from './helpers/time';

// Issue #50: тести автоскасування з вимог (requirements.md §4: SYS-AC-02, 03, 05, 10; US-X.3-AC-02),
// api_spec.md §1, §7–9 і рішень checkin_admin_flow.md, а не з коду. Тести авторів коду
// (autoCancel.test.ts) не використовуються. Планувальник не стартує: cancelExpiredBookings викликається
// напряму або через ліниве скасування в запиті.
//
// Слот 10:00–11:00 за Києвом, дедлайн 10:15 (H01). Рівно в дедлайн не перевіряється (рішення 4).

const app = createApp();

const SLOT_START = '2026-11-03T08:00:00.000Z';
const BEFORE_START = at(SLOT_START, -60); // 09:00
const IN_GRACE = at(SLOT_START, 5); // 10:05
const LATE_IN_GRACE = at(SLOT_START, 14); // 10:14
const AFTER_DEADLINE = at(SLOT_START, 16); // 10:16
// Слот наступного дня: ще не почався, тож бронюється й показується серед вільних (рішення 2).
const TOMORROW_START = '2026-11-04T08:00:00.000Z';
const TOMORROW = '2026-11-04';

async function studentSession(name = 'Студент') {
  const user = await createUser({ name });
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
  expect(res.status).toBe(200);
  return { cookie: sessionCookieFrom(res), userId: user.id };
}

async function bookingOn(startsAt: string, ownerId: string) {
  const room = await createRoom();
  const slot = await createSlot(room.id, startsAt);
  const booking = await createBookingRow('active', { slotId: slot.id, userId: ownerId });
  return { room, slot, booking };
}

async function stored(bookingId: string) {
  return prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
}

async function liveOnSlot(slotId: string) {
  return prisma.booking.count({ where: { slotId, status: { in: [...LIVE_BOOKING_STATUSES] } } });
}

describe('SYS-AC-02: автоскасування непідтвердженого бронювання', () => {
  useClock(IN_GRACE);

  it('SYS-AC-02: active після дедлайну стає auto_cancelled, на слоті немає живого бронювання', async () => {
    const { slot, booking } = await bookingOn(SLOT_START, (await createUser()).id);

    // cancelExpiredBookings повертає кількість усіх прострочених у спільній test.db, тому тут «не менше 1»,
    // а точність перевіряє стан власного бронювання нижче.
    expect(await cancelExpiredBookings(AFTER_DEADLINE)).toBeGreaterThanOrEqual(1);

    const row = await stored(booking.id);
    expect(row.status).toBe('auto_cancelled');
    expect(row.cancelledAt?.toISOString()).toBe(AFTER_DEADLINE.toISOString());
    expect(row.confirmedAt).toBeNull();
    expect(await liveOnSlot(slot.id)).toBe(0);
  });

  it('SYS-AC-02: до дедлайну (10:14) active не чіпається', async () => {
    const { slot, booking } = await bookingOn(SLOT_START, (await createUser()).id);

    await cancelExpiredBookings(LATE_IN_GRACE);

    const row = await stored(booking.id);
    expect(row.status).toBe('active');
    expect(row.cancelledAt).toBeNull();
    expect(await liveOnSlot(slot.id)).toBe(1);
  });

  it('SYS-AC-02 (ADR-0006): без таймера список власника о 10:16 уже показує auto_cancelled', async () => {
    const owner = await studentSession();
    const { booking } = await bookingOn(SLOT_START, owner.userId);
    setClock(() => AFTER_DEADLINE);

    const res = await request(app).get('/api/bookings?scope=past').set('Cookie', owner.cookie);

    expect(res.status).toBe(200);
    const shown = (res.body as BookingListResponse).bookings.filter((b) => b.id === booking.id);
    expect(shown.map((b) => b.status)).toEqual(['auto_cancelled']);
    expect((await stored(booking.id)).status).toBe('auto_cancelled');
  });

  it('SYS-AC-02: повторне автоскасування не змінює вже автоскасований запис', async () => {
    const { booking } = await bookingOn(SLOT_START, (await createUser()).id);
    await cancelExpiredBookings(AFTER_DEADLINE);

    await cancelExpiredBookings(at(AFTER_DEADLINE, 10));

    const row = await stored(booking.id);
    expect(row.status).toBe('auto_cancelled');
    expect(row.cancelledAt?.toISOString()).toBe(AFTER_DEADLINE.toISOString());
  });
});

describe('SYS-AC-03, SYS-AC-05: автоскасування не переписує кінцеві статуси', () => {
  useClock(IN_GRACE);

  it('SYS-AC-03: підтверджене студентом через QR не стає auto_cancelled після дедлайну', async () => {
    const scanner = await studentSession();
    const { room, booking } = await bookingOn(SLOT_START, (await createUser()).id);
    const scan = await request(app)
      .post('/api/check-ins')
      .set('Cookie', scanner.cookie)
      .send({ qrToken: room.qrToken });
    expect(scan.status).toBe(200);

    await cancelExpiredBookings(AFTER_DEADLINE);

    const row = await stored(booking.id);
    expect(row.status).toBe('confirmed');
    expect(row.cancelledAt).toBeNull();
  });

  it('SYS-AC-03: підтверджене адміністратором вручну не стає auto_cancelled після дедлайну', async () => {
    const admin = await adminSession(app);
    const { booking } = await bookingOn(SLOT_START, (await createUser()).id);
    const confirm = await request(app)
      .post(`/api/admin/bookings/${booking.id}/confirm`)
      .set('Cookie', admin.cookie)
      .send({});
    expect(confirm.status).toBe(200);

    await cancelExpiredBookings(AFTER_DEADLINE);

    const row = await stored(booking.id);
    expect(row.status).toBe('confirmed');
    expect(row.confirmedById).toBe(admin.userId);
    expect(row.cancelledAt).toBeNull();
  });

  it('SYS-AC-05: скасоване студентом не переписується на auto_cancelled і не відновлюється', async () => {
    const owner = await studentSession();
    const { booking } = await bookingOn(SLOT_START, owner.userId);
    setClock(() => BEFORE_START);
    const cancel = await request(app)
      .post(`/api/bookings/${booking.id}/cancel`)
      .set('Cookie', owner.cookie)
      .send({});
    expect(cancel.status).toBe(200);
    const cancelledAt = (await stored(booking.id)).cancelledAt?.toISOString();
    expect(cancelledAt).toBe(BEFORE_START.toISOString());

    await cancelExpiredBookings(AFTER_DEADLINE);

    const row = await stored(booking.id);
    expect(row.status).toBe('cancelled_by_student');
    expect(row.cancelledAt?.toISOString()).toBe(cancelledAt);
  });
});

describe('SYS-AC-10, US-X.3-AC-02: звільнення слота й історія', () => {
  useClock(IN_GRACE);

  it('SYS-AC-10: скасоване студентом майбутнє бронювання звільняє слот — він вільний і бронюється іншим', async () => {
    const owner = await studentSession('Олена');
    const other = await studentSession('Богдан');
    const { slot, booking } = await bookingOn(TOMORROW_START, owner.userId);
    expect(
      (await request(app).post(`/api/bookings/${booking.id}/cancel`).set('Cookie', owner.cookie).send({}))
        .status,
    ).toBe(200);

    const available = await request(app)
      .get(`/api/rooms/${slot.roomId}/available-slots?date=${TOMORROW}`)
      .set('Cookie', other.cookie);
    expect(available.status).toBe(200);
    expect((available.body as AvailableSlotListResponse).slots.map((s) => s.id)).toEqual([slot.id]);

    const created = await request(app)
      .post('/api/bookings')
      .set('Cookie', other.cookie)
      .send({ slotId: slot.id });

    expect(created.status).toBe(201);
    expect((created.body as BookingResponse).booking.status).toBe('active');
    expect(await liveOnSlot(slot.id)).toBe(1);
    expect((await stored(booking.id)).status).toBe('cancelled_by_student');
  });

  // Рішення 2 (Q04 «а»): автоскасування настає після початку слота, а розпочатий слот не бронюється
  // через API, тож звільнення перевіряється на рівні сховища: обмеження BR-1 більше не тримає слот.
  it('SYS-AC-10 (рішення 2): після автоскасування сховище приймає новий живий запис на слоті, але не другий', async () => {
    const { slot, booking } = await bookingOn(SLOT_START, (await createUser()).id);
    await cancelExpiredBookings(AFTER_DEADLINE);

    const fresh = await createBookingRow('active', { slotId: slot.id, userId: (await createUser()).id });

    expect(fresh.slotId).toBe(slot.id);
    expect(await liveOnSlot(slot.id)).toBe(1);
    // Другий живий запис відхиляє саме сховище: порушення унікальності Prisma (P2002), частковий індекс BR-1.
    await expect(
      createBookingRow('active', { slotId: slot.id, userId: (await createUser()).id }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect((await stored(booking.id)).status).toBe('auto_cancelled');
  });

  it('US-X.3-AC-02: автоскасоване бронювання є в історії власника зі статусом і часом скасування', async () => {
    const owner = await studentSession();
    const { booking } = await bookingOn(SLOT_START, owner.userId);
    await cancelExpiredBookings(AFTER_DEADLINE);
    setClock(() => AFTER_DEADLINE);

    const res = await request(app).get('/api/bookings?scope=past').set('Cookie', owner.cookie);

    expect(res.status).toBe(200);
    const shown = (res.body as BookingListResponse).bookings.filter((b) => b.id === booking.id);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      id: booking.id,
      status: 'auto_cancelled',
      cancelledAt: AFTER_DEADLINE.toISOString(),
    });
  });
});
