import { prisma } from '../../db/prisma';
import { now } from '../../lib/clock';

// Автоскасування (BR-5, SYS-AC-02, ADR-0006): усі бронювання `active` із дедлайном раніше за `at`
// переходять в `auto_cancelled`. Одне умовне оновлення за поточним станом, без «прочитати → змінити»:
// якщо підтвердження чи скасування студентом виграло гонку, рядок умові вже не відповідає й не
// переписується (SYS-AC-03, SYS-AC-05, SYS-AC-07). Повторний виклик ідемпотентний.
//
// Межа Q01 [Рішення команди, checkin_admin_flow.md, рішення 4]: рівно в `deadline` вікно ще відкрите,
// тому скасовується лише `deadline < at`. Підтвердження (issue #40) використовує додаткову умову
// `deadline >= now`; обидві умови змінюються разом.
//
// Час — лише параметр або `now()` з clock.ts, не клієнтський годинник (FB-10).
export async function cancelExpiredBookings(at: Date = now()): Promise<number> {
  const { count } = await prisma.booking.updateMany({
    where: { status: 'active', deadline: { lt: at } },
    data: { status: 'auto_cancelled', cancelledAt: at },
  });
  return count;
}
