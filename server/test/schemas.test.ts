import { describe, expect, it } from 'vitest';
import {
  AvailableSlotsQuery,
  BookingIdParams,
  CreateBookingBody,
  ListMyBookingsQuery,
  LoginBody,
  RegisterBody,
  RoomIdParams,
} from '@roomly/shared';

const UUID = '0b6c1a2e-1111-4222-8333-444455556666';
const validRegister = { name: 'Олена', email: 'olena@example.com', password: 'secret-pass' };

describe('RegisterBody', () => {
  it('US-1.2-AC-01 приймає валідні дані й нормалізує пошту та ім’я', () => {
    const result = RegisterBody.safeParse({
      ...validRegister,
      name: '  Олена ',
      email: '  Olena@Example.COM ',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ name: 'Олена', email: 'olena@example.com', password: 'secret-pass' });
  });

  it('US-1.2-AC-03 відкидає надіслану роль', () => {
    const result = RegisterBody.safeParse({ ...validRegister, role: 'admin' });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('role');
  });

  it('US-1.2-AC-01 пароль 8…72 символи: межі включно', () => {
    expect(RegisterBody.safeParse({ ...validRegister, password: 'a'.repeat(7) }).success).toBe(false);
    expect(RegisterBody.safeParse({ ...validRegister, password: 'a'.repeat(8) }).success).toBe(true);
    expect(RegisterBody.safeParse({ ...validRegister, password: 'a'.repeat(72) }).success).toBe(true);
    expect(RegisterBody.safeParse({ ...validRegister, password: 'a'.repeat(73) }).success).toBe(false);
  });

  it('US-1.2-AC-01 ім’я 1…100 символів після обрізання пробілів', () => {
    expect(RegisterBody.safeParse({ ...validRegister, name: '   ' }).success).toBe(false);
    expect(RegisterBody.safeParse({ ...validRegister, name: 'я'.repeat(100) }).success).toBe(true);
    expect(RegisterBody.safeParse({ ...validRegister, name: 'я'.repeat(101) }).success).toBe(false);
  });

  it('US-1.2-AC-01 відхиляє некоректну або задовгу пошту', () => {
    const tooLong = `${'a'.repeat(243)}@example.com`;

    expect(RegisterBody.safeParse({ ...validRegister, email: 'olena' }).success).toBe(false);
    expect(RegisterBody.safeParse({ ...validRegister, email: tooLong }).success).toBe(false);
    expect(RegisterBody.safeParse({ ...validRegister, email: tooLong.slice(1) }).success).toBe(true);
  });

  it('US-1.2-AC-01 відхиляє тіло без обов’язкових полів', () => {
    const result = RegisterBody.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['name', 'email', 'password']);
  });
});

describe('LoginBody', () => {
  it('US-X.1a-AC-01 нормалізує пошту так само, як реєстрація', () => {
    const result = LoginBody.safeParse({ email: ' OLENA@example.com', password: 'secret-pass' });

    expect(result.data).toEqual({ email: 'olena@example.com', password: 'secret-pass' });
  });

  it('US-X.1a-AC-02 не перевіряє довжину пароля, але відхиляє порожній', () => {
    expect(LoginBody.safeParse({ email: 'olena@example.com', password: 'x' }).success).toBe(true);
    expect(LoginBody.safeParse({ email: 'olena@example.com', password: '' }).success).toBe(false);
    expect(LoginBody.safeParse({ email: 'olena', password: 'secret-pass' }).success).toBe(false);
  });
});

describe('Параметри шляху', () => {
  it('US-2.1-AC-01 RoomIdParams приймає лише UUID', () => {
    expect(RoomIdParams.safeParse({ roomId: UUID }).success).toBe(true);
    expect(RoomIdParams.safeParse({ roomId: 'R101' }).success).toBe(false);
  });

  it('US-3.2a-AC-01 BookingIdParams приймає лише UUID', () => {
    expect(BookingIdParams.safeParse({ bookingId: UUID }).success).toBe(true);
    expect(BookingIdParams.safeParse({ bookingId: '123' }).success).toBe(false);
  });
});

describe('AvailableSlotsQuery', () => {
  it('US-2.4-AC-01 приймає реальну календарну дату YYYY-MM-DD', () => {
    expect(AvailableSlotsQuery.safeParse({ date: '2026-11-03' }).success).toBe(true);
    expect(AvailableSlotsQuery.safeParse({ date: '2028-02-29' }).success).toBe(true);
  });

  it('US-2.4-AC-01 відхиляє неіснуючу, неповну чи відсутню дату', () => {
    for (const date of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-03', '03.11.2026', undefined]) {
      expect(AvailableSlotsQuery.safeParse({ date }).success, String(date)).toBe(false);
    }
  });
});

describe('CreateBookingBody', () => {
  it('US-3.1-AC-01 приймає slotId і не переносить інших полів', () => {
    const result = CreateBookingBody.safeParse({ slotId: UUID, studentId: UUID });

    expect(result.data).toEqual({ slotId: UUID });
  });

  it('US-3.1-AC-01 відхиляє відсутній або не UUID slotId', () => {
    expect(CreateBookingBody.safeParse({}).success).toBe(false);
    expect(CreateBookingBody.safeParse({ slotId: 'slot-1' }).success).toBe(false);
  });
});

describe('ListMyBookingsQuery', () => {
  it('US-4.2-AC-01 приймає лише upcoming або past', () => {
    expect(ListMyBookingsQuery.safeParse({ scope: 'upcoming' }).success).toBe(true);
    expect(ListMyBookingsQuery.safeParse({ scope: 'past' }).success).toBe(true);
    expect(ListMyBookingsQuery.safeParse({ scope: 'all' }).success).toBe(false);
    expect(ListMyBookingsQuery.safeParse({}).success).toBe(false);
  });
});
