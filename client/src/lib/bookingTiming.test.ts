import type { Booking, BookingStatus } from '@roomly/shared';
import { describe, expect, it } from 'vitest';
import { isReminderDue, isStartNoticeDue, splitStartedBookings } from './bookingView';

// Часова логіка «Моїх бронювань» і деталей (#44): повідомлення на початку, нагадування й секції.
// Межі рівно на початку, кінці слота й рівно 24 год не фіксуються (Q01, Q05/G10).

type Timing = Pick<Booking, 'status' | 'slot' | 'deadline'> & { id: string };
const HOUR = 3_600_000;
const START = Date.parse('2026-11-03T12:00:00.000Z');

function booking(id: string, status: BookingStatus, startsAt = START, hours = 1): Timing {
  return {
    id,
    status,
    slot: {
      id: `slot-${id}`,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + hours * HOUR).toISOString(),
    },
    deadline: new Date(startsAt + 15 * 60_000).toISOString(),
  };
}

const DURING = START + 5 * 60_000;
const NOT_ACTIVE: BookingStatus[] = ['confirmed', 'cancelled_by_student', 'auto_cancelled'];

describe('Повідомлення на початку бронювання', () => {
  it('US-5.4-AC-01: є для активного бронювання, що почалося', () => {
    expect(isStartNoticeDue(booking('a', 'active'), DURING)).toBe(true);
  });

  it('US-5.4-AC-01: немає до початку слота й для не-активних статусів', () => {
    expect(isStartNoticeDue(booking('a', 'active'), START - 5 * 60_000)).toBe(false);
    for (const status of NOT_ACTIVE)
      expect(isStartNoticeDue(booking('b', status), DURING), status).toBe(false);
  });
});

// Робоче рішення 6 (гіпотеза H02): нагадування в застосунку, коли до початку ≤ 24 год. Q05/G10 не
// закрите — «за 24 години» може означати й одноразовий показ. Тести не є прийманням US-4.1 і
// змінюються разом із рішенням команди; точна межа 24 год не перевіряється.
describe('Нагадування за добу (робоче рішення H02, залежить від Q05/G10)', () => {
  it('H02 (Q05/G10 відкрите): є для активного бронювання, що починається через 23 год', () => {
    expect(isReminderDue(booking('a', 'active', START), START - 23 * HOUR)).toBe(true);
  });

  it('H02 (Q05/G10 відкрите): немає за 30 год і для не-активних статусів', () => {
    expect(isReminderDue(booking('a', 'active', START), START - 30 * HOUR)).toBe(false);
    for (const status of NOT_ACTIVE) {
      expect(isReminderDue(booking('b', status, START), START - 23 * HOUR), status).toBe(false);
    }
  });

  it('H02 (Q05/G10 відкрите): для бронювання, що вже почалося, нагадування немає', () => {
    expect(isReminderDue(booking('a', 'active', START), DURING)).toBe(false);
  });
});

describe('Секції «Активні» й «Минулі» (рішення 5)', () => {
  it('US-4.2-AC-01, US-X.3-AC-01: живе бронювання, що триває, — в «Активних», решта — в «Минулих»', () => {
    const active = booking('active', 'active');
    const confirmed = booking('confirmed', 'confirmed');
    const auto = booking('auto', 'auto_cancelled');
    const cancelled = booking('cancelled', 'cancelled_by_student');
    const ended = booking('ended', 'confirmed', START - 3 * HOUR);

    const { ongoing, past } = splitStartedBookings([active, confirmed, auto, cancelled, ended], DURING);

    expect(ongoing.map((b) => b.id)).toEqual(['active', 'confirmed']);
    expect(past.map((b) => b.id)).toEqual(['auto', 'cancelled', 'ended']);
  });

  it('US-X.3-AC-01: жодне бронювання не потрапляє у дві секції й не губиться', () => {
    const all = [
      ...(['active', 'confirmed', 'cancelled_by_student', 'auto_cancelled'] as const).map((s) =>
        booking(s, s),
      ),
      booking('old', 'active', START - 5 * HOUR),
    ];
    const { ongoing, past } = splitStartedBookings(all, DURING);
    const ids = [...ongoing, ...past].map((b) => b.id);
    expect(ids).toHaveLength(all.length);
    expect(new Set(ids).size).toBe(all.length);
  });
});
