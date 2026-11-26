import { describe, expect, it } from 'vitest';
import {
  AvailableSlotsQuery,
  BookingIdParams,
  CheckInBody,
  CreateBookingBody,
  CreateRoomBody,
  CreateSlotBody,
  ListMyBookingsQuery,
  LoginBody,
  RegisterBody,
  RoomIdParams,
  UpdateRoomBody,
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

  it('US-1.2-AC-01 верхня межа пароля — 72 байти UTF-8, а не символи (Q08)', () => {
    // Кирилична літера займає 2 байти: 36 літер = 72 байти, 37 = 74.
    expect(RegisterBody.safeParse({ ...validRegister, password: 'ж'.repeat(36) }).success).toBe(true);

    const tooLong = RegisterBody.safeParse({ ...validRegister, password: 'ж'.repeat(37) });

    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues.map((issue) => [issue.path.join('.'), issue.code])).toEqual([
      ['password', 'too_big'],
    ]);
    // Емодзі — 4 байти: 18 = 72 байти, 19 = 76.
    expect(RegisterBody.safeParse({ ...validRegister, password: '🔑'.repeat(18) }).success).toBe(true);
    expect(RegisterBody.safeParse({ ...validRegister, password: '🔑'.repeat(19) }).success).toBe(false);
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

describe('CheckInBody', () => {
  it('US-5.1-AC-03 відхиляє порожній і 201-символьний qrToken, приймає 200 символів', () => {
    expect(CheckInBody.safeParse({ qrToken: '' }).success).toBe(false);
    expect(CheckInBody.safeParse({}).success).toBe(false);
    expect(CheckInBody.safeParse({ qrToken: 'q'.repeat(201) }).success).toBe(false);
    expect(CheckInBody.safeParse({ qrToken: 'q'.repeat(200) }).success).toBe(true);
  });

  it('US-5.1-AC-03 передає вміст QR без змін (TA-12)', () => {
    const result = CheckInBody.safeParse({ qrToken: ' q7Hn ' });

    expect(result.data).toEqual({ qrToken: ' q7Hn ' });
  });
});

const validRoom = {
  name: 'R101',
  capacity: 6,
  building: 'Корпус 1',
  floor: 2,
  equipment: ['дошка', 'проєктор'],
};

describe('CreateRoomBody', () => {
  it('US-A.1a приймає валідну кімнату й обрізає пробіли в текстових полях', () => {
    const result = CreateRoomBody.safeParse({
      ...validRoom,
      name: ' R101 ',
      building: ' Корпус 1 ',
      equipment: [' дошка '],
      qrToken: 'client-token',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ...validRoom, equipment: ['дошка'] });
  });

  it('US-A.1a приймає порожній перелік обладнання, від’ємний поверх і місткість 1', () => {
    expect(CreateRoomBody.safeParse({ ...validRoom, equipment: [], floor: -1, capacity: 1 }).success).toBe(
      true,
    );
  });

  it('US-A.1a відхиляє місткість 0', () => {
    const result = CreateRoomBody.safeParse({ ...validRoom, capacity: 0 });

    expect(result.error?.issues.map((issue) => [issue.path.join('.'), issue.code])).toEqual([
      ['capacity', 'too_small'],
    ]);
  });

  it('US-A.1a відхиляє нецілий поверх і нецілу місткість', () => {
    expect(CreateRoomBody.safeParse({ ...validRoom, floor: 1.5 }).success).toBe(false);
    expect(CreateRoomBody.safeParse({ ...validRoom, capacity: 2.5 }).success).toBe(false);
  });

  it('US-A.1a обладнання: 20 елементів приймається, 21 відхиляється', () => {
    const items = (count: number) => Array.from({ length: count }, (_, index) => `item-${index}`);

    expect(CreateRoomBody.safeParse({ ...validRoom, equipment: items(20) }).success).toBe(true);
    expect(CreateRoomBody.safeParse({ ...validRoom, equipment: items(21) }).success).toBe(false);
  });

  it('US-A.1a відхиляє повтор в обладнанні, зокрема після обрізання пробілів', () => {
    const exact = CreateRoomBody.safeParse({ ...validRoom, equipment: ['дошка', 'дошка'] });

    expect(exact.error?.issues.map((issue) => [issue.path.join('.'), issue.code])).toEqual([
      ['equipment', 'custom'],
    ]);
    expect(CreateRoomBody.safeParse({ ...validRoom, equipment: ['дошка', ' дошка'] }).success).toBe(false);
  });

  it('US-A.1a елемент обладнання 1…50 символів', () => {
    expect(CreateRoomBody.safeParse({ ...validRoom, equipment: ['я'.repeat(50)] }).success).toBe(true);
    expect(CreateRoomBody.safeParse({ ...validRoom, equipment: ['я'.repeat(51)] }).success).toBe(false);
    expect(CreateRoomBody.safeParse({ ...validRoom, equipment: ['  '] }).success).toBe(false);
  });

  it('US-A.1a назва й корпус 1…100 символів після обрізання', () => {
    expect(CreateRoomBody.safeParse({ ...validRoom, name: '   ' }).success).toBe(false);
    expect(CreateRoomBody.safeParse({ ...validRoom, name: 'я'.repeat(100) }).success).toBe(true);
    expect(CreateRoomBody.safeParse({ ...validRoom, name: 'я'.repeat(101) }).success).toBe(false);
    expect(CreateRoomBody.safeParse({ ...validRoom, building: '' }).success).toBe(false);
    expect(CreateRoomBody.safeParse({ ...validRoom, building: 'я'.repeat(101) }).success).toBe(false);
  });

  it('US-A.1a відхиляє тіло без обов’язкових полів', () => {
    const result = CreateRoomBody.safeParse({});

    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'name',
      'capacity',
      'building',
      'floor',
      'equipment',
    ]);
  });
});

describe('UpdateRoomBody', () => {
  it('US-A.1b відхиляє порожнє тіло й тіло лише з невідомими полями', () => {
    expect(UpdateRoomBody.safeParse({}).success).toBe(false);
    expect(UpdateRoomBody.safeParse({ qrToken: 'x' }).success).toBe(false);
  });

  it('US-A.1b приймає одне поле й не додає інших', () => {
    const result = UpdateRoomBody.safeParse({ capacity: 8 });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ capacity: 8 });
  });

  it('US-A.1b перевіряє передані поля за правилами створення', () => {
    expect(UpdateRoomBody.safeParse({ capacity: 0 }).success).toBe(false);
    expect(UpdateRoomBody.safeParse({ equipment: ['дошка', 'дошка'] }).success).toBe(false);
    expect(UpdateRoomBody.safeParse({ equipment: [] }).success).toBe(true);
  });
});

describe('CreateSlotBody', () => {
  const startsAt = '2026-11-03T12:00:00.000Z';
  const endsAt = '2026-11-03T13:00:00.000Z';

  it('US-A.2 приймає слот у UTC із Z, де endsAt > startsAt', () => {
    expect(CreateSlotBody.safeParse({ startsAt, endsAt }).success).toBe(true);
  });

  it('US-A.2 BR-13 відхиляє endsAt, що дорівнює startsAt або раніший', () => {
    for (const end of [startsAt, '2026-11-03T11:00:00.000Z']) {
      const result = CreateSlotBody.safeParse({ startsAt, endsAt: end });

      expect(
        result.error?.issues.map((issue) => [issue.path.join('.'), issue.code]),
        end,
      ).toEqual([['endsAt', 'custom']]);
    }
  });

  it('US-A.2 відхиляє час без Z, зі зсувом чи не за ISO 8601 лише з причиною формату', () => {
    for (const value of ['2026-11-03T14:00:00.000', '2026-11-03T14:00:00+02:00', '03.11.2026 14:00']) {
      const result = CreateSlotBody.safeParse({ startsAt, endsAt: value });

      expect(
        result.error?.issues.map((issue) => [issue.path.join('.'), issue.code]),
        value,
      ).toEqual([['endsAt', 'invalid_format']]);
    }
    expect(CreateSlotBody.safeParse({ startsAt: '2026-11-03T12:00:00', endsAt }).success).toBe(false);
  });
});
